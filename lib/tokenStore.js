// Stores and retrieves connected-platform OAuth tokens.
//
// This CRM is designed for one business per deployment (not a multi-tenant
// SaaS with separate logins per customer), so tokens are kept in a single
// Firestore collection — one document per platform — rather than keyed to
// an individual user. Everyone who signs into this CRM's workspace shares
// the same connected social accounts, same as they share the same contacts
// and deals.

const { getDb } = require('./firebaseAdmin');

const COLLECTION = 'social_connections';

async function getConnection(platform){
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(platform).get();
  return doc.exists ? doc.data() : null;
}

async function setConnection(platform, data){
  const db = getDb();
  await db.collection(COLLECTION).doc(platform).set({
    ...data,
    updatedAt: Date.now()
  }, { merge: true });
}

module.exports = { getConnection, setConnection };
