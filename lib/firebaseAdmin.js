// Initializes the Firebase Admin SDK once per cold start, using a service
// account key stored in the FIREBASE_SERVICE_ACCOUNT environment variable
// (the whole JSON key file, as a single-line string).
//
// This is what lets the backend read/write Firestore on its own — separate
// from the Firebase config used in the browser, which only ever proves who's
// signed in, never lets the browser write someone else's data.

const admin = require('firebase-admin');

function getAdmin(){
  if(admin.apps.length) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw){
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set — see README.md for how to create one.');
  }
  let serviceAccount;
  try{
    serviceAccount = JSON.parse(raw);
  }catch(e){
    // A malformed paste here is the single most common cause of every
    // billing/auth endpoint failing at once — surface this loudly rather
    // than letting it fail as a generic "invalid token" error downstream.
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON — it was probably cut off or mangled when pasted into Vercel. Re-copy it as one single line from the downloaded key file.');
  }
  if(!serviceAccount.private_key || !serviceAccount.client_email || !serviceAccount.project_id){
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields (private_key, client_email, or project_id) — it may be truncated.');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized for project:', serviceAccount.project_id);
  return admin;
}

function getDb(){
  return getAdmin().firestore();
}

module.exports = { getAdmin, getDb };
