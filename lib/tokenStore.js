// Stores and retrieves connected-platform OAuth tokens — per customer.
//
// Each signed-in account gets its own connections, keyed as
// {uid}_{platform} within one flat collection (keeping the existing
// wildcard Firestore rule — "deny everything" — valid with zero changes,
// since it doesn't care about the key format, only the collection name).

const { getDb } = require('./firebaseAdmin');

const COLLECTION = 'social_connections';

function keyFor(uid, platform){
  return `${uid}_${platform}`;
}

async function getConnection(uid, platform){
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(keyFor(uid, platform)).get();
  return doc.exists ? doc.data() : null;
}

async function setConnection(uid, platform, data){
  const db = getDb();
  await db.collection(COLLECTION).doc(keyFor(uid, platform)).set({
    ...data,
    uid, platform,
    updatedAt: Date.now()
  }, { merge: true });
}

async function deleteConnection(uid, platform){
  const db = getDb();
  await db.collection(COLLECTION).doc(keyFor(uid, platform)).delete().catch(()=>{});
}

module.exports = { getConnection, setConnection, deleteConnection };
