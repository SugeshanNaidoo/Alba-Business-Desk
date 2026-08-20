// Persistence router.
//
// Every CRM create/update/delete goes through persistEntity(). It routes to
// whichever backing store owns that entity right now:
//
//   legacy       -> mutate DATA + saveData()   (the original behaviour)
//   v2           -> write one Firestore document, and mirror into DATA so
//                   the existing render functions keep working unchanged
//   in_progress  -> refuse the write and say why
//
// This is what lets entities migrate one at a time: migrating contacts
// changes only how contacts persist. Deals, tasks and everything else carry
// on through the legacy path untouched.

/* Maps an entity to its DATA array key and its v2 subcollection. */
const ENTITY_STORES = {
  contacts:       { dataKey: 'contacts',        collection: 'contacts' },
  companies:      { dataKey: 'companies',       collection: 'companies' },
  deals:          { dataKey: 'deals',           collection: 'deals' },
  tasks:          { dataKey: 'tasks',           collection: 'tasks' },
  activities:     { dataKey: 'activity',        collection: 'activities' },
  socialAccounts: { dataKey: 'socialPlatforms', collection: 'socialAccounts' }
};

function orgCollection(entity){
  const store = ENTITY_STORES[entity];
  if(!store || !cloudDb || !currentOrgId()) return null;
  return cloudDb.collection('organisations').doc(currentOrgId()).collection(store.collection);
}

/* ---- Sync-on-save --------------------------------------------------------
   The existing modules all follow one shape: mutate a DATA array, then call
   saveData(DATA). Rather than rewrite 36 call sites (and risk missing one,
   which would silently drop writes), migrated entities are synchronised at
   that single choke point by diffing DATA against the last known state.

   Why a diff rather than per-record calls: it is idempotent, it cannot miss
   a mutation performed anywhere in the codebase, and a failed sync simply
   retries on the next save with no lost intent. */

const _lastSynced = {};   // entity -> Map(id -> serialised record)

function _snapshot(arr){
  const m = new Map();
  (arr || []).forEach(r => { if(r && r.id != null) m.set(String(r.id), JSON.stringify(r)); });
  return m;
}

/* Pushes DATA changes for every v2 entity into Firestore. Called (debounced)
   from saveData(). Never touches entities still on legacy. */
async function syncMigratedEntities(){
  if(!ORG_CONTEXT || !cloudDb || !currentOrgId()) return;

  for(const [entity, store] of Object.entries(ENTITY_STORES)){
    if(entityMode(entity) !== 'v2') continue;

    const current = _snapshot(DATA[store.dataKey]);
    const previous = _lastSynced[entity];

    // First sync after hydration establishes the baseline without writing —
    // otherwise every record would be pointlessly rewritten on first save.
    if(!previous){ _lastSynced[entity] = current; continue; }

    const upserts = [];
    const deletes = [];
    current.forEach((json, id) => { if(previous.get(id) !== json) upserts.push([id, json]); });
    previous.forEach((_, id) => { if(!current.has(id)) deletes.push(id); });
    if(!upserts.length && !deletes.length) continue;

    try{
      const col = cloudDb.collection('organisations').doc(currentOrgId()).collection(store.collection);
      // Firestore caps a batch at 500 operations.
      const ops = [...upserts.map(u => ({ type:'set', ...{ id:u[0], json:u[1] } })),
                   ...deletes.map(id => ({ type:'delete', id }))];
      for(let i = 0; i < ops.length; i += 400){
        const batch = cloudDb.batch();
        ops.slice(i, i + 400).forEach(op => {
          if(op.type === 'delete') batch.delete(col.doc(op.id));
          else {
            const { id, ...fields } = JSON.parse(op.json);
            batch.set(col.doc(op.id), { ...fields, updatedAt: Date.now() }, { merge: true });
          }
        });
        await batch.commit();
      }
      _lastSynced[entity] = current;   // only advance the baseline on success
    }catch(err){
      console.error(`Could not sync ${entity}:`, err);
      if(err && err.code === 'permission-denied' && !SUBSCRIPTION_ACTIVE && !hasWarnedAboutBlockedSave){
        hasWarnedAboutBlockedSave = true;
        showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to save your changes.",
          { title: 'Subscription needed' });
      }
      // Baseline deliberately not advanced: the same diff retries next save.
    }
  }
}

/* Establishes the post-hydration baseline so the first save doesn't rewrite
   every record. */
function markEntitiesSynced(){
  for(const [entity, store] of Object.entries(ENTITY_STORES)){
    if(entityMode(entity) === 'v2') _lastSynced[entity] = _snapshot(DATA[store.dataKey]);
  }
}

/* The single write path for CRM records.
   action: 'create' | 'update' | 'delete'
   Returns true on success, false if the write was refused. */
async function persistEntity(entity, action, record){
  const store = ENTITY_STORES[entity];
  if(!store){
    console.error('persistEntity: unknown entity', entity);
    return false;
  }
  const mode = entityMode(entity);

  if(mode === 'in_progress'){
    await showAlert(
      'This section is being upgraded in the background and is temporarily read-only. Please try again in a moment.',
      { title: 'Upgrade in progress' }
    );
    return false;
  }

  // ---- legacy: unchanged original behaviour -------------------------------
  if(mode === 'legacy'){
    saveData(DATA);   // caller has already mutated DATA
    return true;
  }

  // ---- v2: one document per record ---------------------------------------
  const col = orgCollection(entity);
  if(!col){
    await showAlert('Not connected to your workspace right now — please refresh and try again.',
      { title: 'Could not save' });
    return false;
  }
  try{
    if(action === 'delete'){
      await col.doc(String(record.id)).delete();
    }else{
      const { id, ...fields } = record;
      await col.doc(String(id)).set({ ...fields, updatedAt: Date.now() }, { merge: action === 'update' });
    }
    // DATA is already mutated by the caller and acts as the local read-model.
    // Persist it to localStorage only — pushCloudData() strips migrated
    // entities, so this cannot write them back into the legacy payload.
    saveData(DATA);
    return true;
  }catch(err){
    console.error(`Failed to ${action} ${entity}:`, err);
    if(err && err.code === 'permission-denied'){
      await showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to save your changes.",
        { title: 'Subscription needed' });
    }else{
      await showAlert('Could not save that change — please try again.', { title: 'Save failed' });
    }
    return false;
  }
}

/* Loads every migrated entity from Firestore into DATA, so the existing
   render functions see a complete workspace regardless of which entities
   have moved.

   If a migrated entity fails to load we deliberately do NOT fall back to the
   stale localStorage copy — a stale base could be written back over good v2
   data. The entity is left empty and the failure surfaced. */
async function hydrateMigratedEntities(){
  if(!ORG_CONTEXT || !cloudDb) return;
  const failures = [];

  for(const [entity, store] of Object.entries(ENTITY_STORES)){
    if(entityMode(entity) !== 'v2') continue;
    try{
      const snap = await cloudDb.collection('organisations').doc(currentOrgId())
        .collection(store.collection).limit(5000).get();
      DATA[store.dataKey] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }catch(err){
      console.error(`Could not load ${entity} from your workspace:`, err);
      DATA[store.dataKey] = [];
      failures.push(entity);
    }
  }
  markEntitiesSynced();   // baseline from what we just loaded
  if(failures.length){
    showAlert(`Could not load: ${failures.join(', ')}. Please refresh — your data is safe, it just didn't load.`,
      { title: 'Some data did not load' });
  }
}

/* Runs every outstanding entity migration, chunk by chunk, until each is
   done. Safe to call repeatedly: entities already on v2 return immediately,
   and a locked entity is skipped rather than competing. */
async function runPendingMigrations(onProgress){
  if(!ORG_CONTEXT) return { ok:false, reason:'no organisation context' };
  const entities = ['companies','contacts','deals','tasks','activities',
                    'socialAccounts','calendarEvents','whatsapp','files','auditLogs'];
  const summary = {};

  // When the server reports a newer adapter version than the one this
  // workspace was migrated with, already-migrated entities must be re-written
  // by the corrected adapter — so don't skip them.
  const needsRepair = !!(ORG_CONTEXT.adapterVersion && ORG_CONTEXT.storedAdapterVersion
                         && ORG_CONTEXT.storedAdapterVersion < ORG_CONTEXT.adapterVersion);

  for(const entity of entities){
    if(entityMode(entity) === 'v2' && !needsRepair){ summary[entity] = 'already migrated'; continue; }
    let guard = 0;   // bounds the loop even if the server never reports done
    while(guard++ < 200){
      let data;
      try{
        const res = await fetch(`${BACKEND_BASE}/api/organisation?action=migrate&entity=${encodeURIComponent(entity)}`, {
          method:'POST', credentials:'include',
          headers:{ 'X-CSRF-Token': getCsrfToken() }
        });
        data = await res.json();
        if(!res.ok){ summary[entity] = `failed: ${data.error}`; break; }
      }catch(err){
        summary[entity] = `failed: ${err.message}`; break;
      }
      if(onProgress) onProgress(entity, data);
      if(data.done){
        summary[entity] = 'migrated';
        if(ORG_CONTEXT.migration) ORG_CONTEXT.migration[entity] = 'v2';
        break;
      }
      if(data.reason === 'locked'){ summary[entity] = 'locked by another run'; break; }
    }
  }
  return { ok:true, summary };
}
