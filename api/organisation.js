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
const admin = require('firebase-admin');
const { verifySession } = require('../lib/session');
const { resolveOrgContext, roleAtLeast, countActiveSeats, inviteKeyForEmail } = require('../lib/orgContext');
const { checkRateLimit } = require('../lib/rateLimit');
const { isUserSubscribed } = require('../lib/subscriptionCheck');
const { logEvent, clientIp } = require('../lib/auditLog');
const { sendInviteEmail, isConfigured: emailConfigured } = require('../lib/email');

const PRODUCT_DEFAULT_NAME = 'Alba Business Desk';
const DEFAULT_SEAT_LIMIT = 4;   // active members per organisation on R699/month

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

    // Has someone invited this email before they had an account? Convert the
    // pending invite into real membership. Done BEFORE the main transaction
    // so the invite lookup doesn't widen its contention footprint, and
    // guarded so a second sign-in is a harmless no-op.
    let convertedInvite = null;
    if(email){
      try{
        const inviteRef = db.collection('pendingInvites').doc(inviteKeyForEmail(email));
        const inviteSnap = await inviteRef.get();
        if(inviteSnap.exists){
          const inv = inviteSnap.data();
          const orgRef = db.collection('organisations').doc(inv.orgId);
          const orgSnap = await orgRef.get();
          if(orgSnap.exists){
            // Re-check the seat limit at ACCEPT time, not just at invite
            // time — seats may have filled while the invite was outstanding.
            const seats = await countActiveSeats(inv.orgId);
            const limit = orgSnap.data().seatLimit || DEFAULT_SEAT_LIMIT;
            if(seats < limit){
              const now = Date.now();
              await orgRef.collection('members').doc(uid).set({
                uid, email, displayName,
                role: inv.role || 'member',
                status: 'active',
                joinedAt: now,
                invitedBy: inv.invitedBy || null
              }, { merge: true });
              await userRef.set({
                uid, email, displayName,
                activeOrganisationId: inv.orgId,
                organisationIds: admin.firestore.FieldValue.arrayUnion(inv.orgId),
                updatedAt: now
              }, { merge: true });
              await inviteRef.delete().catch(()=>{});
              await logEvent('member_joined', { uid, ip, detail: inv.orgId });
              convertedInvite = { orgId: inv.orgId, role: inv.role || 'member',
                                  name: orgSnap.data().name || '' };
            }else{
              console.error(`Invite for ${uid} not converted — org ${inv.orgId} is at its seat limit.`);
            }
          }
        }
      }catch(e){
        console.error('Pending-invite conversion failed (non-fatal):', e.message);
      }
    }
    if(convertedInvite){
      return res.status(200).json({
        ok: true, created: false, joined: true,
        orgId: convertedInvite.orgId, role: convertedInvite.role,
        organisationName: convertedInvite.name
      });
    }

    const result = await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);

      if(userSnap.exists && userSnap.data().activeOrganisationId){
        const orgId = userSnap.data().activeOrganisationId;
        const memberRef = db.collection('organisations').doc(orgId).collection('members').doc(uid);
        const orgRef = db.collection('organisations').doc(orgId);
        const [memberSnap, orgSnap] = await Promise.all([tx.get(memberRef), tx.get(orgRef)]);

        if(memberSnap.exists && orgSnap.exists){
          const m = memberSnap.data();
          if(m.status === 'active'){
            return { created:false, orgId, role: m.role || 'member', name: orgSnap.data().name || '' };
          }
          // Invited directly (the account already existed when they were
          // invited) — activate on first sign-in.
          if(m.status === 'invited'){
            tx.set(memberRef, { status:'active', joinedAt: Date.now() }, { merge:true });
            return { created:false, joined:true, orgId, role: m.role || 'member', name: orgSnap.data().name || '' };
          }
          // status === 'removed' falls through to the error below.
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
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-settings:${ip}`, { limit: 30, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many changes — please wait a minute.' });
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


/* ---------------------------------------------------------- members ------ */
// Lists active, invited and removed members, plus invites addressed to
// people who don't have an account yet.
async function handleMembers(req, res){
  let ctx;
  try{ ctx = await resolveOrgContext(req); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  try{
    const db = getDb();
    const snap = await db.collection('organisations').doc(ctx.orgId).collection('members').get();
    const members = snap.docs.map(d => {
      const m = d.data();
      return { uid: d.id, email: m.email || '', displayName: m.displayName || '',
               role: m.role || 'member', status: m.status || 'active',
               joinedAt: m.joinedAt || null, removedAt: m.removedAt || null };
    });
    // Pending invites are stored top-level (the invitee has no uid yet), so
    // they're fetched separately and filtered to this organisation.
    const invSnap = await db.collection('pendingInvites').where('orgId','==',ctx.orgId).get();
    const pending = invSnap.docs.map(d => {
      const i = d.data();
      return { inviteId: d.id, email: i.email || '', role: i.role || 'member', invitedAt: i.invitedAt || null };
    });
    const orgSnap = await db.collection('organisations').doc(ctx.orgId).get();
    const seatLimit = (orgSnap.exists && orgSnap.data().seatLimit) || DEFAULT_SEAT_LIMIT;
    return res.status(200).json({
      members, pending, seatLimit,
      seatsUsed: members.filter(m => m.status === 'active').length,
      yourRole: ctx.role, yourUid: ctx.uid
    });
  }catch(err){
    console.error('List members failed:', err);
    return res.status(500).json({ error: 'Could not load the team list.' });
  }
}

/* ----------------------------------------------------------- invite ------ */
async function handleInvite(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  if(!roleAtLeast(ctx.role, 'admin')){
    return res.status(403).json({ error: 'Only an owner or admin can invite people.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-invite:${ip}`, { limit: 20, windowSeconds: 300 }))){
    return res.status(429).json({ error: 'Too many invitations — please wait a few minutes.' });
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const role = String((req.body && req.body.role) || 'member');
  if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if(!['admin','member','viewer'].includes(role)){
    // 'owner' is deliberately not invitable — ownership is tied to billing.
    return res.status(400).json({ error: 'Role must be admin, member or viewer.' });
  }

  try{
    const db = getDb();
    const orgRef = db.collection('organisations').doc(ctx.orgId);
    const orgSnap = await orgRef.get();
    const seatLimit = (orgSnap.exists && orgSnap.data().seatLimit) || DEFAULT_SEAT_LIMIT;
    if((await countActiveSeats(ctx.orgId)) >= seatLimit){
      return res.status(402).json({
        error: `Your plan includes ${seatLimit} active team members. Remove someone, or get in touch to raise the limit.`
      });
    }

    // Already a member of this organisation?
    const existing = await orgRef.collection('members').where('email','==',email).get();
    if(!existing.empty){
      const m = existing.docs[0];
      const status = m.data().status;
      if(status === 'active') return res.status(409).json({ error: 'That person is already on your team.' });
      // Previously removed — re-invite by reactivating rather than creating
      // a duplicate record, so their history stays attached.
      await m.ref.set({ status:'invited', role, invitedBy: ctx.uid, invitedAt: Date.now(),
                        removedAt: null, removedBy: null }, { merge:true });
      await logEvent('member_reinvited', { uid: ctx.uid, ip, detail: email });
      return res.status(200).json({ ok:true, reinvited:true });
    }

    // Does a Firebase account already exist for this address? If so the
    // invite can be written straight to members/{uid}.
    let inviteeUid = null;
    try{ inviteeUid = (await getAdmin().auth().getUserByEmail(email)).uid; }
    catch(e){ /* no account yet — fall through to a pending invite */ }

    const now = Date.now();
    if(inviteeUid){
      await orgRef.collection('members').doc(inviteeUid).set({
        uid: inviteeUid, email, displayName: '',
        role, status: 'invited', invitedBy: ctx.uid, invitedAt: now, joinedAt: null
      }, { merge:true });
    }else{
      await db.collection('pendingInvites').doc(inviteKeyForEmail(email)).set({
        email, orgId: ctx.orgId, role, invitedBy: ctx.uid, invitedAt: now
      });
    }
    await logEvent('member_invited', { uid: ctx.uid, ip, detail: email });

    // Best-effort notification. The invitation already exists in Firestore,
    // so a failure here is reported but never rolls anything back.
    const mail = await sendInviteEmail({
      to: email,
      organisationName: (orgSnap.exists && orgSnap.data().name) || 'your workspace',
      inviterName: ctx.organisation && ctx.uid ? (req.body.inviterName || '') : '',
      role,
      appUrl: process.env.CRM_URL
    });
    return res.status(200).json({ ok:true, pending: !inviteeUid, emailed: mail.sent, emailReason: mail.reason });
  }catch(err){
    console.error('Invite failed:', err);
    return res.status(500).json({ error: 'Could not send that invitation.' });
  }
}

/* -------------------------------------------------------- resend --------- */
async function handleResendInvite(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  if(!roleAtLeast(ctx.role, 'admin')){
    return res.status(403).json({ error: 'Only an owner or admin can resend invitations.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-resend:${ip}`, { limit: 10, windowSeconds: 600 }))){
    return res.status(429).json({ error: 'Too many invitation emails — please wait a few minutes.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if(!email) return res.status(400).json({ error: 'An email address is required.' });
  try{
    const db = getDb();
    const now = Date.now();
    const inviteRef = db.collection('pendingInvites').doc(inviteKeyForEmail(email));
    const inviteSnap = await inviteRef.get();
    if(inviteSnap.exists && inviteSnap.data().orgId === ctx.orgId){
      await inviteRef.set({ invitedAt: now }, { merge:true });
    }else{
      const m = await db.collection('organisations').doc(ctx.orgId)
        .collection('members').where('email','==',email).where('status','==','invited').get();
      if(m.empty) return res.status(404).json({ error: 'No pending invitation for that address.' });
      await m.docs[0].ref.set({ invitedAt: now }, { merge:true });
    }
    await logEvent('member_invite_resent', { uid: ctx.uid, detail: email });

    const orgSnap = await db.collection('organisations').doc(ctx.orgId).get();
    const mail = await sendInviteEmail({
      to: email,
      organisationName: (orgSnap.exists && orgSnap.data().name) || 'your workspace',
      role: 'member',
      appUrl: process.env.CRM_URL
    });
    return res.status(200).json({
      ok: true,
      emailed: mail.sent,
      note: mail.sent
        ? `Invitation re-sent to ${email}.`
        : 'Invitation refreshed, but no email was sent — share the sign-in link with them directly.'
    });
  }catch(err){
    console.error('Resend failed:', err);
    return res.status(500).json({ error: 'Could not resend that invitation.' });
  }
}

/* ------------------------------------------------------- set role -------- */
async function handleSetRole(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  // Only an owner may change roles: an admin promoting themselves to owner
  // would be a privilege-escalation path.
  if(!roleAtLeast(ctx.role, 'owner')){
    return res.status(403).json({ error: 'Only the organisation owner can change roles.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-role:${ip}`, { limit: 30, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many changes — please wait a minute.' });
  }
  const targetUid = String((req.body && req.body.uid) || '');
  const role = String((req.body && req.body.role) || '');
  if(!targetUid || !['owner','admin','member','viewer'].includes(role)){
    return res.status(400).json({ error: 'A member and a valid role are required.' });
  }

  try{
    const db = getDb();
    const orgRef = db.collection('organisations').doc(ctx.orgId);
    await db.runTransaction(async tx => {
      const memberRef = orgRef.collection('members').doc(targetUid);
      const snap = await tx.get(memberRef);
      if(!snap.exists) throw Object.assign(new Error('That person is not on your team.'), { status:404 });

      // Demoting the last owner would lock the organisation out of billing
      // permanently. Checked inside the transaction so two concurrent
      // demotions cannot both pass.
      if(snap.data().role === 'owner' && role !== 'owner'){
        const owners = await tx.get(orgRef.collection('members')
          .where('role','==','owner').where('status','==','active'));
        if(owners.size <= 1){
          throw Object.assign(new Error('An organisation must always have an owner.'), { status:409 });
        }
      }
      tx.set(memberRef, { role, updatedAt: Date.now() }, { merge:true });
    });
    await logEvent('member_role_changed', { uid: ctx.uid, detail: `${targetUid}:${role}` });
    return res.status(200).json({ ok:true });
  }catch(err){
    if(err.status) return res.status(err.status).json({ error: err.message });
    console.error('Set role failed:', err);
    return res.status(500).json({ error: 'Could not change that role.' });
  }
}

/* --------------------------------------------------------- remove -------- */
async function handleRemoveMember(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  if(!roleAtLeast(ctx.role, 'admin')){
    return res.status(403).json({ error: 'Only an owner or admin can remove people.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-remove:${ip}`, { limit: 30, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many changes — please wait a minute.' });
  }
  const targetUid = String((req.body && req.body.uid) || '');
  const inviteEmail = String((req.body && req.body.email) || '').trim().toLowerCase();

  try{
    const db = getDb();
    const orgRef = db.collection('organisations').doc(ctx.orgId);

    // Cancelling an invitation to someone who never had an account.
    if(!targetUid && inviteEmail){
      await db.collection('pendingInvites').doc(inviteKeyForEmail(inviteEmail)).delete().catch(()=>{});
      await logEvent('member_invite_cancelled', { uid: ctx.uid, detail: inviteEmail });
      return res.status(200).json({ ok:true });
    }
    if(!targetUid) return res.status(400).json({ error: 'A member is required.' });

    await db.runTransaction(async tx => {
      const memberRef = orgRef.collection('members').doc(targetUid);
      const snap = await tx.get(memberRef);
      if(!snap.exists) throw Object.assign(new Error('That person is not on your team.'), { status:404 });

      if(snap.data().role === 'owner'){
        const owners = await tx.get(orgRef.collection('members')
          .where('role','==','owner').where('status','==','active'));
        if(owners.size <= 1){
          throw Object.assign(new Error('You cannot remove the only owner. Transfer ownership first — which is not supported yet, so contact support.'), { status:409 });
        }
      }
      // Soft removal: access ends immediately because every rule gates on
      // status == 'active', but the record survives so historical
      // attribution stays intact.
      tx.set(memberRef, {
        status: 'removed', removedAt: Date.now(), removedBy: ctx.uid
      }, { merge:true });
    });
    await logEvent('member_removed', { uid: ctx.uid, detail: targetUid });
    return res.status(200).json({ ok:true });
  }catch(err){
    if(err.status) return res.status(err.status).json({ error: err.message });
    console.error('Remove member failed:', err);
    return res.status(500).json({ error: 'Could not remove that person.' });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;
  if(action === 'bootstrap') return handleBootstrap(req, res);
  if(action === 'context')   return handleContext(req, res);
  if(action === 'settings')  return handleSettings(req, res);
  if(action === 'members')       return handleMembers(req, res);
  if(action === 'invite')        return handleInvite(req, res);
  if(action === 'resend-invite') return handleResendInvite(req, res);
  if(action === 'set-role')      return handleSetRole(req, res);
  if(action === 'remove-member') return handleRemoveMember(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
