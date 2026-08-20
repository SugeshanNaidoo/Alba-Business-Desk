// All organisation operations behind one function, routed by ?action=, so
// later migration phases add no further serverless functions:
//   ?action=bootstrap  (POST) → create-or-return the caller's organisation
//   ?action=context    (GET)  → current { orgId, role, migration } for the caller
//   ?action=settings   (POST) → rename the organisation (owner/admin)
//   ?action=migrate    (POST) → reserved for Phase 4+; returns 501 in Phase 2
//
// Function budget: this is the 9th of 12. Phases 4-14 add actions here
// rather than new functions.

const { setCors } = require('../lib/util');
const { getDb, getAdmin } = require('../lib/firebaseAdmin');
const { verifySession } = require('../lib/session');
const { resolveOrgContext, defaultMigrationState, roleAtLeast,
        readWorkspaceDoc, ensureWorkspaceCopied } = require('../lib/orgContext');
const { checkRateLimit } = require('../lib/rateLimit');
const { isUserSubscribed } = require('../lib/subscriptionCheck');
const { logEvent, clientIp } = require('../lib/auditLog');
const { migrateChunk, listEntities, ADAPTER_VERSION } = require('../lib/entityMigration');
const crypto = require('crypto');

// How long a migration lock is honoured before another request may take it
// over. A process that dies mid-migration leaves a stale lock; without an
// expiry the entity would be stuck in_progress forever.
const MIGRATION_LOCK_TTL_MS = 5 * 60 * 1000;

/* ---------------------------------------------------------------- naming -- */
// The product default must be treated as "unset" — workspaceName defaults to
// 'Alba Business Desk' in defaultData(), so a plain non-empty check would
// name almost every organisation after the product itself.
const PRODUCT_DEFAULT_NAME = 'Alba Business Desk';

function deriveOrgName({ legacyWorkspaceName, displayName }){
  const ws = (legacyWorkspaceName || '').trim();
  if(ws && ws !== PRODUCT_DEFAULT_NAME) return ws.slice(0, 120);
  const dn = (displayName || '').trim();
  if(dn) return `${dn}'s Workspace`.slice(0, 120);
  return 'My Workspace';
}

/* ------------------------------------------------------------- bootstrap -- */
// Idempotent: creates the user profile, organisation and owner membership on
// first call, and returns the existing context on every call after that.
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
    // Read the legacy workspace name OUTSIDE the transaction: transactions
    // may retry, and this read is advisory (naming only), not a consistency
    // requirement. Keeping it out avoids widening the transaction's
    // contention footprint for no benefit.
    // Copy the workspace forward from the old collection name if it hasn't
    // been copied yet. Idempotent and non-destructive: the old document is
    // left in place as the rollback source. Doing this here means it happens
    // before the client ever reads, on every sign-in, with no separate
    // migration job to run.
    try{
      const copy = await ensureWorkspaceCopied(db, uid);
      if(copy.copied) await logEvent('workspace_collection_copied', { uid, ip });
    }catch(e){
      console.error('Workspace copy-forward failed (non-fatal, client falls back):', e.message);
    }

    let legacyWorkspaceName = '';
    try{
      const { snap } = await readWorkspaceDoc(db, uid);
      if(snap.exists && snap.data().payload){
        const parsed = JSON.parse(snap.data().payload);
        legacyWorkspaceName = (parsed.settings && parsed.settings.workspaceName) || '';
      }
    }catch(e){
      console.error('Could not read workspace name (non-fatal):', e.message);
    }

    let authUser = null;
    try{ authUser = await getAdmin().auth().getUser(uid); }catch(e){ /* non-fatal */ }

    const result = await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);

      // Already bootstrapped — verify membership is still valid and return.
      if(userSnap.exists && userSnap.data().activeOrganisationId){
        const orgId = userSnap.data().activeOrganisationId;
        const memberRef = db.collection('organisations').doc(orgId).collection('members').doc(uid);
        const orgRef = db.collection('organisations').doc(orgId);
        const [memberSnap, orgSnap] = await Promise.all([tx.get(memberRef), tx.get(orgRef)]);

        if(memberSnap.exists && memberSnap.data().status === 'active' && orgSnap.exists){
          return { created: false, orgId, role: memberSnap.data().role || 'member', org: orgSnap.data() };
        }
        // Profile points at an org the user is no longer an active member of.
        // Do not silently create a second organisation — that would fork
        // their data. Surface it instead.
        const err = new Error('Your organisation membership is not active. Please contact support.');
        err.status = 403;
        throw err;
      }

      // First bootstrap for this user.
      const orgRef = db.collection('organisations').doc();
      const orgId = orgRef.id;
      const now = Date.now();
      const name = deriveOrgName({
        legacyWorkspaceName,
        displayName: (authUser && authUser.displayName) || decoded.name || ''
      });

      tx.set(orgRef, {
        name,
        ownerId: uid,
        dataModelVersion: 2,   // describes the ORG RECORD shape only — never
                               // gates entity persistence. See MIGRATION.md.
        // Every entity starts legacy: creating an organisation does NOT mean
        // any CRM data has moved.
        migration: defaultMigrationState(),
        migrationMeta: {
          sourceUid: uid,
          cursors: {},
          lastError: null,
          lock: null,
          updatedAt: now
        },
        // Mirrored from subscriptions/{uid} by the backend. Never client-written.
        subscription: { status: 'unknown', plan: 'business', updatedAt: now },
        createdAt: now,
        updatedAt: now
      });

      tx.set(orgRef.collection('members').doc(uid), {
        uid,
        email: (authUser && authUser.email) || decoded.email || '',
        displayName: (authUser && authUser.displayName) || decoded.name || '',
        role: 'owner',
        status: 'active',
        joinedAt: now,
        invitedBy: null
      });

      // organisationIds is a CACHE. Written in the same transaction as the
      // membership document so the two can never diverge.
      tx.set(userRef, {
        uid,
        email: (authUser && authUser.email) || decoded.email || '',
        displayName: (authUser && authUser.displayName) || decoded.name || '',
        photoURL: (authUser && authUser.photoURL) || null,
        activeOrganisationId: orgId,
        organisationIds: [orgId],
        createdAt: userSnap.exists ? (userSnap.data().createdAt || now) : now,
        updatedAt: now
      }, { merge: true });

      return { created: true, orgId, role: 'owner', org: { name, migration: defaultMigrationState() } };
    });

    if(result.created){
      await logEvent('organisation_created', { uid, ip, detail: result.orgId });
    }

    // Refresh the subscription mirror from the authoritative source. Outside
    // the transaction: it is a convenience copy, and subscriptions/{uid}
    // remains the source of truth for every access decision.
    try{
      const sub = await db.collection('subscriptions').doc(uid).get();
      const status = sub.exists ? (sub.data().status || 'none') : 'none';
      await db.collection('organisations').doc(result.orgId)
        .set({ subscription: { status, plan: 'business', updatedAt: Date.now() } }, { merge: true });
    }catch(e){
      console.error('Subscription mirror refresh failed (non-fatal):', e.message);
    }

    return res.status(200).json({
      ok: true,
      created: result.created,
      orgId: result.orgId,
      role: result.role,
      organisationName: result.org.name || '',
      migration: Object.assign(defaultMigrationState(), result.org.migration || {}),
      // The client compares this against the org's stored value to decide
      // whether already-migrated entities need re-writing by a fixed adapter.
      adapterVersion: ADAPTER_VERSION,
      storedAdapterVersion: (result.org.adapterVersion || 1)
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
      migration: ctx.migration,
      adapterVersion: ADAPTER_VERSION
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
      .set({ name: name.slice(0, 120), updatedAt: Date.now() }, { merge: true });
    await logEvent('organisation_renamed', { uid: ctx.uid, detail: ctx.orgId });
    return res.status(200).json({ ok: true, name: name.slice(0, 120) });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not update the organisation.' });
  }
}

/* --------------------------------------------------- migration locking ---- */
// Exported for Phase 4+. Implemented now so the locking semantics are settled
// and reviewed before any entity actually migrates.
//
// Atomicity: the lock is claimed inside a transaction, so two concurrent
// requests cannot both believe they hold it. A caller that loses the race
// gets { acquired:false, state } and returns the current state rather than
// starting a competing migration.
async function acquireMigrationLock(orgId, entity, { ttlMs = MIGRATION_LOCK_TTL_MS } = {}){
  const db = getDb();
  const orgRef = db.collection('organisations').doc(orgId);

  return db.runTransaction(async tx => {
    const snap = await tx.get(orgRef);
    if(!snap.exists) throw Object.assign(new Error('Organisation not found.'), { status: 404 });

    const data = snap.data();
    const migration = Object.assign(defaultMigrationState(), data.migration || {});
    const meta = data.migrationMeta || {};
    const lock = meta.lock || null;
    const now = Date.now();

    if(migration[entity] === 'v2'){
      return { acquired: false, reason: 'already_migrated', state: migration[entity] };
    }

    // A live lock held by someone else — do not compete.
    if(lock && lock.entity === entity && lock.expiresAt > now){
      return { acquired: false, reason: 'locked', migrationId: lock.migrationId,
               state: migration[entity], expiresAt: lock.expiresAt };
    }

    // Free, or the previous holder's lock expired (a died/timed-out process).
    // Note the entity deliberately stays in_progress across that failure —
    // partial v2 writes may exist, so reverting to legacy would be unsafe.
    const migrationId = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

    tx.set(orgRef, {
      migration: { ...migration, [entity]: 'in_progress' },
      migrationMeta: {
        ...meta,
        lock: { migrationId, entity, startedAt: now, updatedAt: now, expiresAt: now + ttlMs },
        updatedAt: now
      }
    }, { merge: true });

    return { acquired: true, migrationId, resumedFrom: (meta.cursors || {})[entity] || null };
  });
}

// Heartbeat — extends the lock while a long migration is still making
// progress, and records the cursor so a later request can resume.
async function touchMigrationLock(orgId, entity, migrationId, cursor, { ttlMs = MIGRATION_LOCK_TTL_MS } = {}){
  const db = getDb();
  const orgRef = db.collection('organisations').doc(orgId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(orgRef);
    const meta = (snap.exists && snap.data().migrationMeta) || {};
    if(!meta.lock || meta.lock.migrationId !== migrationId){
      return { ok: false, reason: 'lock_lost' };   // someone else took over
    }
    const now = Date.now();
    tx.set(orgRef, {
      migrationMeta: {
        ...meta,
        cursors: { ...(meta.cursors || {}), [entity]: cursor },
        lock: { ...meta.lock, updatedAt: now, expiresAt: now + ttlMs },
        updatedAt: now
      }
    }, { merge: true });
    return { ok: true };
  });
}

// Releases the lock. `outcome` is 'completed' (entity → v2) or 'failed'
// (entity STAYS in_progress and the error is recorded — never reverted to
// legacy, because partial v2 writes may already exist).
async function releaseMigrationLock(orgId, entity, migrationId, outcome, error){
  const db = getDb();
  const orgRef = db.collection('organisations').doc(orgId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(orgRef);
    if(!snap.exists) return { ok: false };
    const data = snap.data();
    const migration = Object.assign(defaultMigrationState(), data.migration || {});
    const meta = data.migrationMeta || {};
    if(meta.lock && meta.lock.migrationId !== migrationId){
      return { ok: false, reason: 'lock_lost' };
    }
    const now = Date.now();
    tx.set(orgRef, {
      migration: { ...migration, [entity]: outcome === 'completed' ? 'v2' : 'in_progress' },
      migrationMeta: {
        ...meta,
        lock: null,
        lastError: outcome === 'completed' ? null : (error || 'Migration failed'),
        updatedAt: now
      }
    }, { merge: true });
    return { ok: true };
  });
}

// Chunked, resumable, lock-protected entity migration.
//
// Call repeatedly with the same entity until { done: true }. Each call
// processes up to CHUNK_SIZE records and records a cursor, so a timeout or a
// dead process is recoverable — the next call resumes where it stopped.
async function handleMigrate(req, res){
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status || 401).json({ error: err.message }); }
  if(!roleAtLeast(ctx.role, 'owner')){
    return res.status(403).json({ error: 'Only the organisation owner can run a migration.' });
  }
  // Migration writes CRM data, so it needs the same entitlement as any other
  // write. Without this an unpaid account could migrate and then be blocked
  // by the Firestore rules — a confusing half-state.
  if(!(await isUserSubscribed(ctx.uid))){
    return res.status(402).json({ error: 'An active subscription is needed to upgrade your workspace.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`org-migrate:${ip}`, { limit: 120, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many migration requests — please wait a minute.' });
  }

  const entity = (req.query.entity || '').trim();
  if(!listEntities().includes(entity)){
    return res.status(400).json({ error: `Unknown entity. One of: ${listEntities().join(', ')}` });
  }
  // Normally a v2 entity is skipped. But when the adapter version has moved
  // on, the stored documents were written by an older (here: incorrect)
  // mapping and must be re-written. Re-running is safe — same document ids,
  // merged — so it repairs in place.
  const orgSnap = await getDb().collection('organisations').doc(ctx.orgId).get();
  const storedAdapterVersion = (orgSnap.exists && orgSnap.data().adapterVersion) || 1;
  const needsRepair = storedAdapterVersion < ADAPTER_VERSION;

  if(ctx.migration[entity] === 'v2' && !needsRepair){
    return res.status(200).json({ ok: true, done: true, entity, state: 'v2', note: 'Already migrated.' });
  }

  // Claim the lock. A competing request gets the current state back rather
  // than starting a second run over the same entity.
  let lock;
  try{ lock = await acquireMigrationLock(ctx.orgId, entity); }
  catch(err){ return res.status(err.status || 500).json({ error: err.message }); }

  if(!lock.acquired){
    return res.status(200).json({
      ok: true, done: lock.reason === 'already_migrated',
      entity, state: lock.state, reason: lock.reason,
      note: lock.reason === 'locked'
        ? 'Another migration for this entity is already running.'
        : undefined
    });
  }

  try{
    const result = await migrateChunk(ctx.orgId, ctx.uid, entity, lock.resumedFrom || 0);

    if(result.done){
      await releaseMigrationLock(ctx.orgId, entity, lock.migrationId, 'completed');
      await getDb().collection('organisations').doc(ctx.orgId)
        .set({ adapterVersion: ADAPTER_VERSION, updatedAt: Date.now() }, { merge: true });
      await logEvent('entity_migrated', { uid: ctx.uid, ip, detail: `${entity}:${result.total}` });
      return res.status(200).json({ ok: true, done: true, entity, state: 'v2', ...result });
    }
    // More to do — persist the cursor, keep the lock warm, ask for another call.
    await touchMigrationLock(ctx.orgId, entity, lock.migrationId, result.cursor);
    return res.status(200).json({ ok: true, done: false, entity, state: 'in_progress', ...result });
  }catch(err){
    console.error(`Migration failed for ${entity}:`, err);
    // Deliberately leaves the entity in_progress: partial v2 writes may
    // exist, so reverting to legacy would be unsafe. The cursor is retained
    // so a later call resumes rather than restarting.
    await releaseMigrationLock(ctx.orgId, entity, lock.migrationId, 'failed', err.message);
    return res.status(500).json({ error: err.message, entity, state: 'in_progress' });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;
  if(action === 'bootstrap') return handleBootstrap(req, res);
  if(action === 'context')   return handleContext(req, res);
  if(action === 'settings')  return handleSettings(req, res);
  if(action === 'migrate')   return handleMigrate(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};

// Exported for Phase 4+ migration routines.
module.exports.acquireMigrationLock = acquireMigrationLock;
module.exports.touchMigrationLock = touchMigrationLock;
module.exports.releaseMigrationLock = releaseMigrationLock;
module.exports.MIGRATION_LOCK_TTL_MS = MIGRATION_LOCK_TTL_MS;
