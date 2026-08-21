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

/* Entities the rules treat as append-only history: create is allowed, update
   and delete are denied. The sync must respect that, or every save would
   issue writes the rules reject and retry them forever. */
const APPEND_ONLY = new Set(['activities']);

const ACTIVITY_PAGE_SIZE = 50;   // recent activity fetched on first paint
const ENTITY_LOAD_LIMIT  = 5000; // per-collection ceiling for everything else

let _activityCursor = null;      // last doc of the loaded activity page
let _activityHasMore = false;

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

/* Repairs documents that use an older field naming.

   The app briefly wrote some records with canonical names (title/createdAt
   instead of text/timestamp) before the storage rewrite. A single such
   document made the dashboard render "undefined / NaNd ago". This fills the
   expected field ONLY when it is genuinely missing — it never overwrites a
   real value — and because the repaired record then differs from the stored
   one, the next sync writes the correction back permanently. */
function normaliseRecord(entity, r){
  const fill = (want, from) => {
    if(r[want] === undefined && r[from] !== undefined) r[want] = r[from];
  };
  if(entity === 'activities'){
    fill('text','title'); fill('timestamp','createdAt');
    if(r.text === undefined) r.text = 'Activity';
    if(r.timestamp === undefined) r.timestamp = Date.now();
  }
  if(entity === 'contacts'){ fill('tag','status'); }
  if(entity === 'deals'){
    fill('closeDate','expectedCloseDate'); fill('owner','assignedTo');
    // Dates are 'YYYY-MM-DD' strings in this app; an older build stored some
    // as numeric timestamps, which broke every sort and comparison.
    if(r.closeDate !== undefined) r.closeDate = toDateStr(r.closeDate);
  }
  if(entity === 'tasks'){
    // NOTE: the canonical field here is `dueDate` (not `due`) — an earlier
    // version of this normaliser had that backwards.
    fill('dueDate','due'); fill('owner','assignedTo');
    if(r.dueDate !== undefined) r.dueDate = toDateStr(r.dueDate);
  }
  if(entity === 'activities' && r.timestamp !== undefined && typeof r.timestamp === 'string'){
    const n = Date.parse(r.timestamp);
    if(!isNaN(n)) r.timestamp = n;   // timestamps are numbers here
  }
  if(entity === 'socialSnapshots' && r.date !== undefined) r.date = toDateStr(r.date);
  if(entity === 'socialMentions' && r.date !== undefined) r.date = toDateStr(r.date);
  if(entity === 'socialPlatforms'){ fill('handle','username'); }
  return r;
}

/* Loads the whole workspace into DATA. Called once after the organisation is
   resolved, before the first render. */
async function loadWorkspace(){
  const ref = orgRef();
  if(!ref) return { ok:false, reason:'no organisation' };

  const failures = [];
  const truncated = [];

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
      // Activity is the largest collection by far and almost none of it is
      // needed on first paint. Load only the most recent page; older entries
      // arrive via loadMoreActivity(), and a specific record's full history
      // via loadActivityFor() when its drawer opens.
      let query = ref.collection(store.collection);
      if(entity === 'activities'){
        query = query.orderBy('timestamp', 'desc').limit(ACTIVITY_PAGE_SIZE);
      } else {
        query = query.limit(ENTITY_LOAD_LIMIT);
      }
      const snap = await query.get();
      DATA[store.dataKey] = snap.docs.map(d => normaliseRecord(entity, { id: d.id, ...d.data() }));
      if(entity === 'activities'){
        _activityCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
        _activityHasMore = snap.docs.length === ACTIVITY_PAGE_SIZE;
      } else if(snap.docs.length === ENTITY_LOAD_LIMIT){
        // Silent truncation would make the app look fine while quietly
        // hiding records. Say so instead.
        console.warn(`${entity}: hit the ${ENTITY_LOAD_LIMIT}-record load limit — some records were not loaded.`);
        truncated.push(entity);
      }
      if(entity === 'socialSnapshots'){
        DATA[store.dataKey].sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')));
      }
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
  if(truncated.length){
    showAlert(`You have more ${truncated.join(' and ')} than this view can load at once (${ENTITY_LOAD_LIMIT}). Everything is safely stored — get in touch and we'll raise the limit.`,
      { title:'Large workspace' });
  }
  return { ok:true, truncated };
}

/* Merges fetched activity into DATA without duplicating, keeping the array
   sorted newest-first. Used by both pagination and per-record fetches. */
function _mergeActivity(records){
  const seen = new Set(DATA.activity.map(a => String(a.id)));
  let added = 0;
  records.forEach(r => {
    if(seen.has(String(r.id))) return;
    DATA.activity.push(r);
    seen.add(String(r.id));
    added++;
  });
  DATA.activity.sort((a,b) => (Number(b.timestamp)||0) - (Number(a.timestamp)||0));
  // Newly merged records already exist in Firestore. Fold them into the sync
  // baseline so the next save doesn't try to re-create them — activities are
  // append-only, so a re-create would be rejected.
  if(added && _lastSynced.activities){
    _lastSynced.activities = _snapshot(DATA.activity);
  }
  return added;
}

/* Fetches the next page of older activity for the dashboard feed. */
async function loadMoreActivity(){
  const ref = orgRef();
  if(!ref || !_activityHasMore) return { added:0, hasMore:false };
  try{
    let q = ref.collection('activities').orderBy('timestamp','desc').limit(ACTIVITY_PAGE_SIZE);
    if(_activityCursor) q = q.startAfter(_activityCursor);
    const snap = await q.get();
    const added = _mergeActivity(snap.docs.map(d => normaliseRecord('activities', { id:d.id, ...d.data() })));
    _activityCursor = snap.docs.length ? snap.docs[snap.docs.length-1] : _activityCursor;
    _activityHasMore = snap.docs.length === ACTIVITY_PAGE_SIZE;
    return { added, hasMore:_activityHasMore };
  }catch(err){
    console.error('Could not load more activity:', err);
    return { added:0, hasMore:_activityHasMore, error:err.message };
  }
}
function activityHasMore(){ return _activityHasMore; }

/* Fetches ALL activity for one contact or deal.

   Without this, paginating the feed would silently shorten every record's
   timeline — the drawer filters DATA.activity, which now holds only a recent
   page. This queries the record's own history directly so the timeline stays
   complete regardless of how much of the feed is loaded. */
const _activityFetched = new Set();
async function loadActivityFor(relatedType, relatedId){
  const ref = orgRef();
  if(!ref || !relatedId) return 0;
  const key = `${relatedType}:${relatedId}`;
  if(_activityFetched.has(key)) return 0;   // already have it this session
  try{
    const snap = await ref.collection('activities')
      .where('relatedType','==',relatedType)
      .where('relatedId','==',relatedId)
      .orderBy('timestamp','desc').limit(200).get();
    _activityFetched.add(key);
    return _mergeActivity(snap.docs.map(d => normaliseRecord('activities', { id:d.id, ...d.data() })));
  }catch(err){
    // A missing composite index surfaces here. The timeline still shows
    // whatever is already loaded rather than breaking.
    console.error('Could not load activity for', key, err);
    return 0;
  }
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

    const appendOnly = APPEND_ONLY.has(entity);
    const ops = [];
    current.forEach((json, id) => {
      if(previous.get(id) === json) return;
      // For append-only entities only genuinely NEW records may be written.
      // An edit to an existing one would be rejected by the rules, so it is
      // skipped rather than retried on every subsequent save.
      if(appendOnly && previous.has(id)) return;
      ops.push({ type:'set', id, json, isNew: !previous.has(id) });
    });
    if(!appendOnly){
      previous.forEach((_, id) => { if(!current.has(id)) ops.push({ type:'delete', id }); });
    }
    if(!ops.length){ _lastSynced[entity] = current; continue; }

    try{
      const col = ref.collection(store.collection);
      // Firestore caps a batch at 500 operations.
      for(let i = 0; i < ops.length; i += 400){
        const batch = cloudDb.batch();
        ops.slice(i, i + 400).forEach(op => {
          if(op.type === 'delete') batch.delete(col.doc(op.id));
          else {
            const { id, ...fields } = JSON.parse(op.json);
            batch.set(col.doc(op.id), { ...fields, updatedAt: Date.now() },
              appendOnly ? {} : { merge:true });
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
