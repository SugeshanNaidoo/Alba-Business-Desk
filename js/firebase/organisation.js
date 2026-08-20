// Organisation context for the browser.
//
// PHASE 2 SCOPE: this file establishes identity and tenancy only. Every
// entity ships in 'legacy' mode, so persistence behaves exactly as it did
// before — the v2 machinery below is present but inert until Phase 4.
//
// Load order matters: this file must load AFTER core.js (it uses
// BACKEND_BASE) and BEFORE init.js (which gates the first render on it).

/* ORG_CONTEXT is null until bootstrap resolves. Every consumer must treat
   null as "legacy" rather than as an error — see entityMode(). */
let ORG_CONTEXT = null;
let orgContextReady = false;
let orgContextError = null;   // last bootstrap failure, surfaced in Settings

/* The single source of truth for which DATA keys belong to which migratable
   entity. pushCloudData() uses this to strip migrated entities out of the
   legacy payload.

   MUST stay in sync with lib/orgContext.js on the server. If they diverge,
   the safe direction is for the client to think FEWER entities have migrated
   (it then writes a superset to the legacy payload, which the read side
   ignores for migrated keys). */
const ENTITY_KEYS = {
  contacts:       ['contacts'],
  companies:      ['companies'],
  deals:          ['deals'],
  tasks:          ['tasks'],
  activities:     ['activity'],
  calendarEvents: [],
  socialAccounts: ['socialPlatforms', 'socialSnapshots', 'socialPosts', 'socialMentions'],
  whatsapp:       [],
  files:          [],
  auditLogs:      []
};

/* Returns 'legacy' | 'in_progress' | 'v2' for an entity.

   FAIL-SAFE BY DESIGN — every unknown path returns 'legacy':
     - no context loaded yet        → legacy
     - context load failed          → legacy
     - entity absent from the map   → legacy
   The consequence of guessing wrong in this direction is that data is
   written to the legacy payload (recoverable). Guessing the other way would
   silently stop persistence (data loss). */
function entityMode(entity){
  if(!ORG_CONTEXT || !ORG_CONTEXT.migration) return 'legacy';
  return ORG_CONTEXT.migration[entity] || 'legacy';
}

/* True when an entity's data must not be written by anyone — either a
   migration is mid-flight, or it failed partway and is awaiting a resume.
   Phase 4+ uses this to put the relevant UI into a read-only error state
   rather than silently discarding edits. */
function entityIsLocked(entity){
  return entityMode(entity) === 'in_progress';
}

/* Which DATA keys are no longer owned by the legacy payload. */
function migratedPayloadKeys(){
  const keys = [];
  for(const [entity, dataKeys] of Object.entries(ENTITY_KEYS)){
    if(entityMode(entity) !== 'legacy') keys.push(...dataKeys);
  }
  return keys;
}

/* Establishes the organisation for the signed-in user. Idempotent server
   side: safe to call on every sign-in. */
async function initOrgContext(){
  try{
    const res = await fetch(`${BACKEND_BASE}/api/organisation?action=bootstrap`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    const data = await res.json();
    if(!res.ok){
      // Deliberately NOT fatal. The organisation layer is additive in Phase 2
      // — if it fails, every entity stays 'legacy' and the app runs exactly
      // as it did before. Failing closed here would break a working product
      // for the sake of a layer nothing depends on yet.
      console.error('Organisation bootstrap failed — continuing on legacy persistence:', data.error);
      orgContextError = `${res.status}: ${data.error || 'Unknown error'}`;
      ORG_CONTEXT = null;
      return null;
    }
    ORG_CONTEXT = {
      orgId: data.orgId,
      role: data.role,
      organisationName: data.organisationName || '',
      migration: data.migration || {},
      // Used to detect that already-migrated entities were written by an
      // older adapter and need re-writing.
      adapterVersion: data.adapterVersion || 1,
      storedAdapterVersion: data.storedAdapterVersion || data.adapterVersion || 1
    };
    return ORG_CONTEXT;
  }catch(err){
    console.error('Could not reach the organisation endpoint — continuing on legacy persistence:', err);
    orgContextError = `Could not reach /api/organisation (${err.message}). Is the backend deployed?`;
    ORG_CONTEXT = null;
    return null;
  }finally{
    orgContextReady = true;
  }
}

function currentOrgId(){ return ORG_CONTEXT ? ORG_CONTEXT.orgId : null; }
function currentRole(){ return ORG_CONTEXT ? ORG_CONTEXT.role : null; }

/* Role gate for UI affordances. NEVER the only check — every sensitive
   action is also enforced server-side in api/organisation.js and, for data,
   in Firestore rules. */
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
function roleAtLeast(minimum){
  const r = currentRole();
  if(!r) return false;
  return (ROLE_RANK[r] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}
