// Organisation operations, routed by ?action=:
//   ?action=bootstrap (POST) → create-or-return the caller's organisation
//   ?action=context   (GET)  → { orgId, role, organisationName } for the caller
//   ?action=settings  (POST) → rename the organisation (owner/admin)
//
// The application is organisation-native: there is no legacy workspace
// document and no migration path. Bootstrap creates the organisation, the
// owner membership and the user profile in a single transaction.

const { setCors } = require('../lib/util');
const { getDb, getAdmin } = require('../lib/firebaseAdmin');
const { verifySession } = require('../lib/session');
const { resolveOrgContext, roleAtLeast } = require('../lib/orgContext');
const { checkRateLimit } = require('../lib/rateLimit');
const { isUserSubscribed } = require('../lib/subscriptionCheck');
const { logEvent, clientIp } = require('../lib/auditLog');

const PRODUCT_DEFAULT_NAME = 'Alba Business Desk';

function deriveOrgName(displayName){
  const dn = (displayName || '').trim();
  if(dn) return `${dn}'s Workspace`.slice(0, 120);
  return 'My Workspace';
}

/* ------------------------------------------------------------- bootstrap -- */
// Idempotent: creates the profile, organisation and owner membership on the
// first call and returns the existing context on every call afterwards.
async function handleBootstrap(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }

  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-bootstrap:${ip}`, { limit: 20, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many requests — please wait a minute.' });
  }

  const uid = decoded.uid;
  const db = getDb();
  const userRef = db.collection('users').doc(uid);

  try{
    let authUser = null;
    try{ authUser = await getAdmin().auth().getUser(uid); }catch(e){ /* non-fatal */ }
    const displayName = (authUser && authUser.displayName) || decoded.name || '';
    const email = (authUser && authUser.email) || decoded.email || '';

    const result = await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);

      if(userSnap.exists && userSnap.data().activeOrganisationId){
        const orgId = userSnap.data().activeOrganisationId;
        const memberRef = db.collection('organisations').doc(orgId).collection('members').doc(uid);
        const orgRef = db.collection('organisations').doc(orgId);
        const [memberSnap, orgSnap] = await Promise.all([tx.get(memberRef), tx.get(orgRef)]);

        if(memberSnap.exists && memberSnap.data().status === 'active' && orgSnap.exists){
          return { created:false, orgId, role: memberSnap.data().role || 'member', name: orgSnap.data().name || '' };
        }
        // The profile points at an organisation the user is no longer an
        // active member of. Do NOT create a second organisation — that would
        // fork their data. Surface it instead.
        const err = new Error('Your organisation membership is not active. Please contact support.');
        err.status = 403;
        throw err;
      }

      const orgRef = db.collection('organisations').doc();
      const orgId = orgRef.id;
      const now = Date.now();
      const name = deriveOrgName(displayName);

      tx.set(orgRef, {
        name,
        ownerId: uid,
        // Mirrored from subscriptions/{uid} by the backend below. The rules
        // read subscriptions/{ownerId} directly and never trust this copy.
        subscription: { status: 'unknown', plan: 'business', updatedAt: now },
        createdAt: now,
        updatedAt: now
      });

      tx.set(orgRef.collection('members').doc(uid), {
        uid, email, displayName,
        role: 'owner', status: 'active',
        joinedAt: now, invitedBy: null
      });

      // organisationIds is a convenience CACHE — membership is authoritative
      // at organisations/{orgId}/members/{uid}. Written in the same
      // transaction so the two cannot diverge.
      tx.set(userRef, {
        uid, email, displayName,
        photoURL: (authUser && authUser.photoURL) || null,
        activeOrganisationId: orgId,
        organisationIds: [orgId],
        createdAt: userSnap.exists ? (userSnap.data().createdAt || now) : now,
        updatedAt: now
      }, { merge: true });

      return { created:true, orgId, role:'owner', name };
    });

    if(result.created) await logEvent('organisation_created', { uid, ip, detail: result.orgId });

    // Refresh the subscription mirror from the authoritative source.
    try{
      const sub = await db.collection('subscriptions').doc(uid).get();
      const status = sub.exists ? (sub.data().status || 'none') : 'none';
      await db.collection('organisations').doc(result.orgId)
        .set({ subscription: { status, plan:'business', updatedAt: Date.now() } }, { merge:true });
    }catch(e){
      console.error('Subscription mirror refresh failed (non-fatal):', e.message);
    }

    return res.status(200).json({
      ok: true,
      created: result.created,
      orgId: result.orgId,
      role: result.role,
      organisationName: result.name
    });
  }catch(err){
    if(err.status) return res.status(err.status).json({ error: err.message });
    console.error('Bootstrap failed:', err);
    return res.status(500).json({ error: 'Could not set up your organisation.' });
  }
}

/* --------------------------------------------------------------- context -- */
async function handleContext(req, res){
  try{
    const ctx = await resolveOrgContext(req);
    return res.status(200).json({
      orgId: ctx.orgId,
      role: ctx.role,
      organisationName: ctx.organisation.name,
      // Diagnostic: if the Billing tab and this disagree, they are reading
      // different accounts.
      uid: ctx.uid,
      subscriptionActive: await isUserSubscribed(ctx.organisation.ownerId || ctx.uid)
    });
  }catch(err){
    return res.status(err.status || 500).json({ error: err.message });
  }
}

/* -------------------------------------------------------------- settings -- */
async function handleSettings(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }

  if(!roleAtLeast(ctx.role, 'admin')){
    return res.status(403).json({ error: 'Only an owner or admin can change organisation settings.' });
  }
  const name = ((req.body && req.body.name) || '').trim();
  if(!name) return res.status(400).json({ error: 'An organisation name is required.' });

  try{
    await getDb().collection('organisations').doc(ctx.orgId)
      .set({ name: name.slice(0,120), updatedAt: Date.now() }, { merge:true });
    await logEvent('organisation_renamed', { uid: ctx.uid, detail: ctx.orgId });
    return res.status(200).json({ ok:true, name: name.slice(0,120) });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not update the organisation.' });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;
  if(action === 'bootstrap') return handleBootstrap(req, res);
  if(action === 'context')   return handleContext(req, res);
  if(action === 'settings')  return handleSettings(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
