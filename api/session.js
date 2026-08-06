// Establishes or clears the HttpOnly session cookie used by the billing
// endpoints. The CRM calls ?action=login once, right after Firebase sign-in
// completes, trading its short-lived ID token for a longer-lived session
// cookie the browser then sends automatically — the ID token itself is
// never stored anywhere after this point.

const { setCors, setCookie, parseCookies } = require('../lib/util');
const { getAdmin } = require('../lib/firebaseAdmin');
const { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } = require('../lib/session');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const crypto = require('crypto');

async function handleLogin(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = clientIp(req);
  if(!(await checkRateLimit(`session-login:${ip}`, { limit: 20, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many attempts — please wait a minute and try again.' });
  }

  const authHeader = req.headers['authorization'];
  const idToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : (req.body && req.body.idToken);
  if(!idToken) return res.status(400).json({ error: 'Missing ID token.' });

  let decoded;
  try{
    decoded = await getAdmin().auth().verifyIdToken(idToken);
  }catch(e){
    console.error('Login token verification failed:', e.code || e.message);
    return res.status(401).json({ error: 'Could not verify sign-in — please try again.' });
  }

  try{
    const sessionCookie = await getAdmin().auth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_SECONDS * 1000 });
    setCookie(res, SESSION_COOKIE_NAME, sessionCookie, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, httpOnly: true });
    const csrfToken = crypto.randomBytes(24).toString('hex');
    setCookie(res, CSRF_COOKIE_NAME, csrfToken, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, httpOnly: false });
    logEvent('session_login', { uid: decoded.uid, ip });
    return res.status(200).json({ ok: true });
  }catch(e){
    console.error('Could not create session cookie:', e.message);
    return res.status(500).json({ error: 'Could not start a session.' });
  }
}

async function handleLogout(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const cookies = parseCookies(req);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if(sessionCookie){
    try{
      const decoded = await getAdmin().auth().verifySessionCookie(sessionCookie).catch(()=>null);
      if(decoded){
        await getAdmin().auth().revokeRefreshTokens(decoded.uid).catch(()=>{});
        logEvent('session_logout', { uid: decoded.uid, ip: clientIp(req) });
      }
    }catch(e){ /* best effort — still clear cookies below either way */ }
  }
  setCookie(res, SESSION_COOKIE_NAME, '', { maxAgeSeconds: 0, httpOnly: true });
  setCookie(res, CSRF_COOKIE_NAME, '', { maxAgeSeconds: 0, httpOnly: false });
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;
  if(action === 'login') return handleLogin(req, res);
  if(action === 'logout') return handleLogout(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
