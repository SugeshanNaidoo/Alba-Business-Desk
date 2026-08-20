// Generic entity migration: legacy monolithic payload -> per-entity
// subcollections under organisations/{orgId}.
//
// One engine for every entity rather than ten bespoke routines. Each entity
// declares only how to read its records out of the legacy payload and how to
// shape a v2 document; everything else — locking, chunking, cursors, resume,
// idempotency — is shared.
//
// SAFETY PROPERTIES
//  * Idempotent: documents are written with their ORIGINAL legacy id, so
//    re-running overwrites the same doc rather than creating duplicates.
//  * Resumable: progress is recorded as an index cursor after every chunk.
//  * Non-destructive: the legacy payload is never modified or deleted here.
//  * Chunked: 400 entity writes per batch, well inside Firestore's 500-op
//    limit and comfortably inside a 10s function timeout.

const { getDb } = require('./firebaseAdmin');
const { readWorkspaceDoc } = require('./orgContext');

const CHUNK_SIZE = 400;

// Bump when an adapter changes in a way that requires re-writing documents
// that were already migrated. Stored on the organisation; a lower stored
// value causes those entities to be migrated again. Re-running is safe:
// documents keep their original ids and are merged, so a re-run repairs in
// place rather than duplicating.
const ADAPTER_VERSION = 2;   // entity docs per batch; see MIGRATION.md batch budget

function ts(v){
  if(!v) return null;
  if(typeof v === 'number') return v;
  const n = Date.parse(v);
  return isNaN(n) ? null : n;
}

/* Per-entity adapters.

   CRITICAL CONTRACT: each map() spreads the original record (`...r`) FIRST.
   The v2 document is a SUPERSET of the legacy one — canonical field names
   are added alongside the originals, never in place of them.

   This exists because the UI is a compatibility layer: every render function
   still reads legacy field names (a.text, a.timestamp, c.tag, d.closeDate,
   d.owner, t.due). An earlier version of these adapters renamed fields, and
   the dashboard immediately rendered "undefined / NaNd ago" because the
   documents no longer carried `text` or `timestamp`.

   Renaming can only happen once every reader has been updated — which is a
   later, separate piece of work, not part of moving storage.
   `key`      – the DATA key holding the array in the legacy payload
   `collection` – subcollection name under organisations/{orgId}
   `map`      – legacy record -> v2 document

   Records keep their legacy id (`r.id`) as the Firestore document id, which
   is what makes re-running the migration safe and preserves every existing
   cross-reference (deal.contactId, task.dealId, …) without rewriting. */
const ADAPTERS = {
  contacts: {
    key: 'contacts', collection: 'contacts',
    map: (r, ctx) => ({
      ...r,                       // preserve EVERY legacy field verbatim
      name: r.name || '',
      firstName: (r.name || '').split(' ')[0] || '',
      lastName: (r.name || '').split(' ').slice(1).join(' ') || '',
      email: r.email || '', phone: r.phone || '',
      // Legacy stores a company NAME string, not an id. Resolve it against
      // the payload's company list; keep the raw name when unmatched rather
      // than discarding information.
      companyId: ctx.companyIdByName[(r.company || '').trim().toLowerCase()] || null,
      legacyCompanyName: r.company || '',
      status: r.tag || '', source: r.source || '',
      notes: r.notes || '',
      customFields: r.customFields || {},
      createdBy: ctx.uid,
      createdAt: ts(r.createdAt) || Date.now(),
      updatedAt: Date.now()
    })
  },
  companies: {
    key: 'companies', collection: 'companies',
    map: (r, ctx) => ({
      ...r,
      name: r.name || '', industry: r.industry || '',
      website: r.website || '', notes: r.notes || '',
      createdBy: ctx.uid,
      createdAt: ts(r.createdAt) || Date.now(),
      updatedAt: Date.now()
    })
  },
  deals: {
    key: 'deals', collection: 'deals',
    map: (r, ctx) => ({
      ...r,
      title: r.title || '',
      contactId: r.contactId || null, companyId: r.companyId || null,
      value: Number(r.value) || 0,
      stage: r.stage || '', probability: Number(r.probability) || 0,
      priority: r.priority || 'medium',
      assignedTo: r.owner || r.assignedTo || null,
      expectedCloseDate: ts(r.closeDate || r.expectedCloseDate),
      lostReason: r.lostReason || null,
      stageHistory: Array.isArray(r.stageHistory) ? r.stageHistory : [],
      notes: r.notes || '',
      createdBy: ctx.uid,
      createdAt: ts(r.createdAt) || Date.now(),
      updatedAt: Date.now()
    })
  },
  tasks: {
    key: 'tasks', collection: 'tasks',
    map: (r, ctx) => ({
      ...r,
      title: r.title || '', description: r.notes || r.description || '',
      status: r.done ? 'done' : 'open', done: !!r.done,
      priority: r.priority || 'medium',
      dueDate: ts(r.due || r.dueDate),
      assignedTo: r.owner || r.assignedTo || null,
      contactId: r.contactId || null, dealId: r.dealId || null,
      recurring: r.recurring || null,
      createdBy: ctx.uid,
      createdAt: ts(r.createdAt) || Date.now(),
      updatedAt: Date.now()
    })
  },
  activities: {
    key: 'activity', collection: 'activities',
    map: (r, ctx) => ({
      ...r,
      type: r.type || 'note',
      title: r.text || '', description: '',
      contactId: r.relatedType === 'contact' ? (r.relatedId || null) : null,
      dealId:    r.relatedType === 'deal'    ? (r.relatedId || null) : null,
      userId: ctx.uid,
      metadata: {},
      createdAt: ts(r.timestamp) || Date.now()
    })
  },
  socialAccounts: {
    // Platform CARDS only — display metadata the user created. Real OAuth
    // tokens stay in social_connections/, deliberately outside
    // organisations/ so org-membership rules can never expose them.
    key: 'socialPlatforms', collection: 'socialAccounts',
    map: (r, ctx) => ({
      ...r,
      platform: (r.name || '').toLowerCase(),
      displayName: r.name || '', username: r.handle || '',
      followers: Number(r.followers) || 0,
      status: 'active',
      connectedBy: ctx.uid,
      createdAt: ts(r.createdAt) || Date.now(),
      updatedAt: Date.now()
    })
  }
};

// Entities with nothing in the legacy payload to copy. Flipping these to v2
// is a state change only — there is no data to move.
const NO_DATA_ENTITIES = ['calendarEvents', 'whatsapp', 'files', 'auditLogs'];

function listEntities(){ return [...Object.keys(ADAPTERS), ...NO_DATA_ENTITIES]; }

/* Migrates one chunk. Returns { done, processed, total, cursor }.
   The caller re-invokes with the returned cursor until done === true. */
async function migrateChunk(orgId, uid, entity, cursor){
  const db = getDb();

  if(NO_DATA_ENTITIES.includes(entity)){
    return { done: true, processed: 0, total: 0, cursor: 0 };
  }
  const adapter = ADAPTERS[entity];
  if(!adapter) throw Object.assign(new Error(`Unknown entity: ${entity}`), { status: 400 });

  const { snap } = await readWorkspaceDoc(db, uid);
  if(!snap.exists || !snap.data().payload){
    return { done: true, processed: 0, total: 0, cursor: 0 };
  }

  let payload;
  try{ payload = JSON.parse(snap.data().payload); }
  catch(e){ throw Object.assign(new Error('Legacy payload is not valid JSON.'), { status: 500 }); }

  const records = Array.isArray(payload[adapter.key]) ? payload[adapter.key] : [];
  const total = records.length;
  const start = Number(cursor) || 0;
  if(start >= total) return { done: true, processed: 0, total, cursor: total };

  // Company name -> id map, needed by the contacts adapter.
  const companyIdByName = {};
  (payload.companies || []).forEach(co => {
    if(co && co.name) companyIdByName[String(co.name).trim().toLowerCase()] = co.id;
  });
  const ctx = { uid, companyIdByName };

  const slice = records.slice(start, start + CHUNK_SIZE);
  const batch = db.batch();
  const colRef = db.collection('organisations').doc(orgId).collection(adapter.collection);

  slice.forEach((r, i) => {
    // Preserve the legacy id. Falls back to a positional id only if a record
    // somehow has none — still deterministic, so re-running is still safe.
    const docId = String(r.id || `${entity}_${start + i}`);
    batch.set(colRef.doc(docId), { ...adapter.map(r, ctx), legacyId: docId }, { merge: true });
  });
  await batch.commit();

  const next = start + slice.length;
  return { done: next >= total, processed: slice.length, total, cursor: next };
}

module.exports = { migrateChunk, listEntities, ADAPTERS, NO_DATA_ENTITIES, CHUNK_SIZE, ADAPTER_VERSION };
