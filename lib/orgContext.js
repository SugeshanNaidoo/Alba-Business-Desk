// Resolves the organisation context for an authenticated request.
//
// AUTHORITATIVE MEMBERSHIP: organisations/{orgId}/members/{uid} with
// status === 'active'. users/{uid}.organisationIds is a convenience cache
// only and is NEVER consulted for an access decision — a stale or tampered
// cache must not be able to grant access to an organisation.

const { getDb } = require('./firebaseAdmin');
const { verifySession } = require('./session');

// Collection rename (flowline_* -> albabusinessdesk_*).
//
// The OLD collection holds every existing customer's workspace. Renaming a
// Firestore collection does not move data — it orphans it. So both names
// exist here: the new one is authoritative, the old one is read as a
// fallback and copied forward once, lazily, on bootstrap. The old
// collection is NOT deleted; it remains the rollback source until Phase 14.
const WORKSPACE_COLLECTION = 'albabusinessdesk_crm_users';
const LEGACY_WORKSPACE_COLLECTION = 'flowline_crm_users';

// Reads a user's workspace document, preferring the new collection and
// falling back to the old one. Returns { snap, fromLegacy } so callers can
// tell whether a copy-forward is still outstanding.
async function readWorkspaceDoc(db, uid){
  const fresh = await db.collection(WORKSPACE_COLLECTION).doc(uid).get();
  if(fresh.exists) return { snap: fresh, fromLegacy: false };
  const legacy = await db.collection(LEGACY_WORKSPACE_COLLECTION).doc(uid).get();
  return { snap: legacy, fromLegacy: legacy.exists };
}

// Idempotent copy-forward. Only writes if the new document is absent and the
// old one exists, so re-running is a no-op and can never clobber newer data.
async function ensureWorkspaceCopied(db, uid){
  const fresh = await db.collection(WORKSPACE_COLLECTION).doc(uid).get();
  if(fresh.exists) return { copied: false, reason: 'already_present' };
  const legacy = await db.collection(LEGACY_WORKSPACE_COLLECTION).doc(uid).get();
  if(!legacy.exists) return { copied: false, reason: 'nothing_to_copy' };
  await db.collection(WORKSPACE_COLLECTION).doc(uid).set({
    ...legacy.data(),
    copiedFromLegacyAt: Date.now()
  });
  return { copied: true };
}

// Every entity that will eventually move to its own subcollection, with the
// DATA keys it owns. Phase 2 ships this map with every entity in 'legacy',
// so nothing changes behaviourally — see MIGRATION.md.
const ENTITY_KEYS = {
  contacts:       ['contacts'],
  companies:      ['companies'],
  deals:          ['deals'],
  tasks:          ['tasks'],
  activities:     ['activity'],
  calendarEvents: [],   // net-new in v2; nothing in the legacy payload to strip
  socialAccounts: ['socialPlatforms', 'socialSnapshots', 'socialPosts', 'socialMentions'],
  whatsapp:       [],   // already lives outside the payload
  files:          [],   // net-new
  auditLogs:      []    // already lives outside the payload
};

function defaultMigrationState(){
  const state = {};
  for(const entity of Object.keys(ENTITY_KEYS)) state[entity] = 'legacy';
  return state;
}

// Resolves { uid, orgId, role, migration } for a request, or throws with a
// .status so routes can pass it straight through.
async function resolveOrgContext(req, { requireCsrf = false } = {}){
  const decoded = await verifySession(req, { requireCsrf });
  const uid = decoded.uid;
  const db = getDb();

  const userDoc = await db.collection('users').doc(uid).get();
  if(!userDoc.exists){
    const err = new Error('No user profile yet — call ?action=bootstrap first.');
    err.status = 409;
    throw err;
  }
  const orgId = userDoc.data().activeOrganisationId;
  if(!orgId){
    const err = new Error('No active organisation — call ?action=bootstrap first.');
    err.status = 409;
    throw err;
  }

  // Authoritative check: the membership document itself.
  const memberDoc = await db.collection('organisations').doc(orgId)
    .collection('members').doc(uid).get();
  if(!memberDoc.exists || memberDoc.data().status !== 'active'){
    const err = new Error('You are not an active member of this organisation.');
    err.status = 403;
    throw err;
  }

  const orgDoc = await db.collection('organisations').doc(orgId).get();
  if(!orgDoc.exists){
    const err = new Error('Organisation not found.');
    err.status = 404;
    throw err;
  }
  const org = orgDoc.data();

  return {
    uid,
    orgId,
    role: memberDoc.data().role || 'member',
    organisation: {
      name: org.name || '',
      ownerId: org.ownerId,
      dataModelVersion: org.dataModelVersion || 2
    },
    // Merged over defaults so an entity added in a later release is treated
    // as 'legacy' rather than undefined.
    migration: Object.assign(defaultMigrationState(), org.migration || {})
  };
}

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
function roleAtLeast(role, minimum){
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}

module.exports = { resolveOrgContext, ENTITY_KEYS, defaultMigrationState, roleAtLeast, ROLE_RANK,
  WORKSPACE_COLLECTION, LEGACY_WORKSPACE_COLLECTION, readWorkspaceDoc, ensureWorkspaceCopied };
