// Verifies the Firebase ID token the browser sends along with billing
// requests, so we know for certain which signed-in account we're checking
// out or checking the status of — never trust a uid the client just hands
// us directly, always verify the token that proves it.

const { getAdmin } = require('./firebaseAdmin');

async function verifyRequestToken(req){
  // Prefer a proper Authorization header (used by fetch() calls from the app).
  // Fall back to a query param for the one place that can't send custom
  // headers — a full-page redirect into the PayFast checkout form.
  let token = null;
  const authHeader = req.headers['authorization'];
  if(authHeader && authHeader.startsWith('Bearer ')){
    token = authHeader.slice(7);
  } else if(req.query && req.query.idToken){
    token = req.query.idToken;
  }
  if(!token){
    const err = new Error('No ID token provided.');
    err.status = 401;
    throw err;
  }
  try{
    const decoded = await getAdmin().auth().verifyIdToken(token);
    return decoded; // decoded.uid is what you want
  }catch(e){
    const err = new Error('Invalid or expired sign-in token.');
    err.status = 401;
    throw err;
  }
}

module.exports = { verifyRequestToken };
