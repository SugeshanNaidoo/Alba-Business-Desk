// Resolves the organisation context for an authenticated request.
//
// AUTHORITATIVE MEMBERSHIP: organisations/{orgId}/members/{uid} with
// status === 'active'. users/{uid}.organisationIds is a convenience cache
// only and is NEVER consulted for an access decision — a stale or tampered
// cache must not be able to grant access to an organisation.

const { getDb } = require('./firebaseAdmin');
const { verifySession } = require('./session');

// Resolves { uid, orgId, role } for a request, or throws with a
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
      ownerId: org.ownerId
    }
  };
}

/* Counts seats that actually consume the plan limit: active members only.
   A pending invite costs nothing until accepted, and a removed member frees
   their seat immediately. */
async function countActiveSeats(orgId){
  const snap = await getDb().collection('organisations').doc(orgId)
    .collection('members').where('status', '==', 'active').get();
  return snap.size;
}

/* Stable key for an invite addressed to an email that has no account yet.
   Hashed so the collection can never be harvested as a list of addresses. */
function inviteKeyForEmail(email){
  return require('crypto').createHash('sha256')
    .update(String(email || '').trim().toLowerCase()).digest('hex');
}

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
function roleAtLeast(role, minimum){
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}

module.exports = { resolveOrgContext, roleAtLeast, ROLE_RANK, countActiveSeats, inviteKeyForEmail };
