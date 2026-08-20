// Workspace persistence — organisation-native.
//
// Two stores, no legacy path:
//
//   organisations/{orgId}/config/workspace   one document holding workspace
//                                            configuration (stages, statuses,
//                                            custom fields, targets…). Small,
//                                            bounded, always read together.
//
//   organisations/{orgId}/{entity}/{id}      one document per record for the
//                                            collections that grow without
//                                            bound (contacts, deals, tasks…).
//
// DATA remains the in-memory read-model every render function consumes. It is
// hydrated from Firestore on sign-in and written back by diffing on save.

/* Entity collections: DATA key -> Firestore subcollection. */
const ENTITY_STORES = {
  contacts:        { dataKey: 'contacts',         collection: 'contacts' },
  companies:       { dataKey: 'companies',        collection: 'companies' },
  deals:           { dataKey: 'deals',            collection: 'deals' },
  tasks:           { dataKey: 'tasks',            collection: 'tasks' },
  activities:      { dataKey: 'activity',         collection: 'activities' },
  socialPlatforms: { dataKey: 'socialPlatforms',  collection: 'socialAccounts' },
  socialSnapshots: { dataKey: 'socialSnapshots',  collection: 'socialSnapshots' },
  socialPosts:     { dataKey: 'socialPosts',      collection: 'socialPosts' },
  socialMentions:  { dataKey: 'socialMentions',   collection: 'socialMentions' }
};

/* Configuration keys — stored together in one document. These are bounded and
   always loaded as a unit, so splitting them into per-record documents would
   cost reads for no benefit. */
const CONFIG_KEYS = ['settings','stages','contactStatuses','leadSources',
                     'customFieldDefs','teamMembers','lostReasons','salesTargets'];

const _lastSynced = {};        // entity -> Map(id -> serialised record)
let _lastConfig = null;        // serialised config, to detect changes

function orgRef(){
  return (cloudDb && currentOrgId())
    ? cloudDb.collection('organisations').doc(currentOrgId())
    : null;
}

function _snapshot(arr){
  const m = new Map();
  (arr || []).forEach(r => { if(r && r.id != null) m.set(String(r.id), JSON.stringify(r)); });
  return m;
}
function _configOf(d){
  const o = {};
  CONFIG_KEYS.forEach(k => { if(d[k] !== undefined) o[k] = d[k]; });
  return o;
}

/* Loads the whole workspace into DATA. Called once after the organisation is
   resolved, before the first render. */
async function loadWorkspace(){
  const ref = orgRef();
  if(!ref) return { ok:false, reason:'no organisation' };

  const failures = [];

  // Configuration.
  try{
    const cfg = await ref.collection('config').doc('workspace').get();
    if(cfg.exists){
      const data = cfg.data();
      CONFIG_KEYS.forEach(k => { if(data[k] !== undefined) DATA[k] = data[k]; });
    }
    _lastConfig = JSON.stringify(_configOf(DATA));
  }catch(err){
    console.error('Could not load workspace configuration:', err);
    failures.push('settings');
  }

  // Entity collections.
  for(const [entity, store] of Object.entries(ENTITY_STORES)){
    try{
      const snap = await ref.collection(store.collection).limit(5000).get();
      DATA[store.dataKey] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _lastSynced[entity] = _snapshot(DATA[store.dataKey]);
    }catch(err){
      console.error(`Could not load ${entity}:`, err);
      // Leave the array empty rather than falling back to a stale local copy —
      // a stale base could be written back over good data on the next save.
      DATA[store.dataKey] = [];
      failures.push(entity);
    }
  }

  if(failures.length){
    showAlert(`Could not load: ${failures.join(', ')}. Your data is safe — please refresh.`,
      { title:'Some data did not load' });
    return { ok:false, failures };
  }
  return { ok:true };
}

/* Writes DATA back to Firestore by diffing against the last known state.

   The modules all mutate a DATA array then call saveData(), so syncing at
   that single choke point means no CRUD call site can be missed. The diff is
   idempotent, and a failed sync simply retries on the next save because the
   baseline only advances on success. */
async function syncWorkspace(){
  const ref = orgRef();
  if(!ref) return;

  // Configuration — one document, written only when it actually changed.
  try{
    const cfg = _configOf(DATA);
    const serialised = JSON.stringify(cfg);
    if(serialised !== _lastConfig){
      await ref.collection('config').doc('workspace').set({ ...cfg, updatedAt: Date.now() }, { merge:true });
      _lastConfig = serialised;
    }
  }catch(err){
    console.error('Could not save workspace configuration:', err);
    _reportWriteFailure(err);
  }

  // Entities — per-record upserts and deletes.
  for(const [entity, store] of Object.entries(ENTITY_STORES)){
    const current = _snapshot(DATA[store.dataKey]);
    const previous = _lastSynced[entity];
    if(!previous){ _lastSynced[entity] = current; continue; }   // no baseline yet

    const ops = [];
    current.forEach((json, id) => { if(previous.get(id) !== json) ops.push({ type:'set', id, json }); });
    previous.forEach((_, id) => { if(!current.has(id)) ops.push({ type:'delete', id }); });
    if(!ops.length) continue;

    try{
      const col = ref.collection(store.collection);
      // Firestore caps a batch at 500 operations.
      for(let i = 0; i < ops.length; i += 400){
        const batch = cloudDb.batch();
        ops.slice(i, i + 400).forEach(op => {
          if(op.type === 'delete') batch.delete(col.doc(op.id));
          else {
            const { id, ...fields } = JSON.parse(op.json);
            batch.set(col.doc(op.id), { ...fields, updatedAt: Date.now() }, { merge:true });
          }
        });
        await batch.commit();
      }
      _lastSynced[entity] = current;   // advance the baseline only on success
    }catch(err){
      console.error(`Could not sync ${entity}:`, err);
      _reportWriteFailure(err);
    }
  }
}

function _reportWriteFailure(err){
  if(err && err.code === 'permission-denied' && !SUBSCRIPTION_ACTIVE && !hasWarnedAboutBlockedSave){
    hasWarnedAboutBlockedSave = true;
    showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to save your changes.",
      { title:'Subscription needed' });
  }
}
