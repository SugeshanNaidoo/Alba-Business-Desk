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
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return admin;
}

function getDb(){
  return getAdmin().firestore();
}

module.exports = { getAdmin, getDb };
