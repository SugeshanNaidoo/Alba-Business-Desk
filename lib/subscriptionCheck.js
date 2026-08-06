// Checks whether a given account currently has an active subscription.
// Used to gate real functionality (connecting platforms, syncing, creating
// calendar events, saving CRM data) server-side — a UI-only check can
// always be bypassed by someone editing requests directly, so anything
// that actually matters is enforced here or in Firestore rules, not just
// by hiding a button.

const { getDb } = require('./firebaseAdmin');

async function isUserSubscribed(uid){
  if(!uid) return false;
  try{
    const doc = await getDb().collection('subscriptions').doc(uid).get();
    return doc.exists && doc.data().status === 'active';
  }catch(e){
    console.error('Could not check subscription status:', e.message);
    return false; // fail closed — an error checking status should never grant access
  }
}

module.exports = { isUserSubscribed };
