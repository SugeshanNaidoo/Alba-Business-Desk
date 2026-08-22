// Stores and retrieves connected-platform OAuth tokens — per ORGANISATION.
//
// Connections belong to the workspace, not the person who happened to click
// Connect: a team shares one Instagram account, and an admin leaving must not
// take the integration with them.
//
// Keyed as {orgId}_{platform} in one flat collection, deliberately OUTSIDE
// organisations/ so that no membership rule can ever expose a raw token —
// physical separation is the safety property, not just the rule.

const { getDb } = require('./firebaseAdmin');

const COLLECTION = 'social_connections';

function keyFor(orgId, platform){
  return `${orgId}_${platform}`;
}

async function getConnection(orgId, platform){
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(keyFor(orgId, platform)).get();
  return doc.exists ? doc.data() : null;
}

async function setConnection(orgId, platform, data){
  const db = getDb();
  await db.collection(COLLECTION).doc(keyFor(orgId, platform)).set({
    ...data,
    orgId, platform,
    updatedAt: Date.now()
  }, { merge: true });
}

async function deleteConnection(orgId, platform){
  const db = getDb();
  await db.collection(COLLECTION).doc(keyFor(orgId, platform)).delete().catch(()=>{});
}

module.exports = { getConnection, setConnection, deleteConnection };
