// Verifies the HttpOnly session cookie set by /api/session?action=login,
// replacing the old Authorization: Bearer flow for the billing endpoints.
// For state-changing requests, also checks a CSRF token — necessary now
// that auth rides on a cookie the browser attaches automatically, which
// bearer-token-in-header auth was never vulnerable to in the first place.

const { getAdmin } = require('./firebaseAdmin');
const { parseCookies } = require('./util');

const SESSION_COOKIE_NAME = 'abd_session';
const CSRF_COOKIE_NAME = 'abd_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60; // 5 days (Firebase's own cap is 14)

async function verifySession(req, { requireCsrf = false } = {}){
  const cookies = parseCookies(req);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if(!sessionCookie){
    const err = new Error('Not signed in.');
    err.status = 401;
    throw err;
  }

  let decoded;
  try{
    decoded = await getAdmin().auth().verifySessionCookie(sessionCookie, true);
  }catch(e){
    console.error('Session verification failed:', e.code || e.message);
    const err = new Error('Your session has expired — please sign in again.');
    err.status = 401;
    throw err;
  }

  if(requireCsrf){
    const csrfCookie = cookies[CSRF_COOKIE_NAME];
    const csrfHeader = req.headers[CSRF_HEADER_NAME];
    if(!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader){
      const err = new Error('Could not verify this request — please refresh the page and try again.');
      err.status = 403;
      throw err;
    }
  }

  return decoded;
}

module.exports = { verifySession, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_MAX_AGE_SECONDS };
