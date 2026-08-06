// Start + callback for the Facebook Page OAuth flow, kept as one function
// instead of two to stay within Vercel Hobby's serverless function limit.
//   (no code param)            → redirects into Meta's consent screen (the "start")
//   ?code=... (or ?error=...) → Meta's redirect back after approval/denial (the "callback")
// Register THIS url as the app's OAuth redirect URI in Meta's dashboard
// (Facebook Login for Business product settings):
//   {APP_BASE_URL}/api/oauth-meta
//
// Facebook Pages ONLY — Instagram now runs through a completely separate
// login system (see api/oauth-instagram.js).
//
// Every connection belongs to the signed-in account that made it — not
// shared workspace-wide — and connecting requires an active subscription,
// same as any other real functionality in the CRM.

const { setCors, parseCookies, setCookie, normalizeBaseUrl } = require('../lib/util');
const { setConnection } = require('../lib/tokenStore');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');
const { isUserSubscribed } = require('../lib/subscriptionCheck');
const crypto = require('crypto');

const GRAPH_VERSION = 'v22.0';

async function handleStart(req, res){
  let decoded;
  try{
    decoded = await verifySession(req);
  }catch(err){
    return res.status(err.status||401).send('You need to be signed in to connect a social account. Go back to the CRM, sign in with Google, and try again.');
  }
  if(!(await isUserSubscribed(decoded.uid))){
    return res.status(402).send('An active subscription is needed to connect social accounts. Go back to the CRM and subscribe from the Billing tab first.');
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`oauth-meta-start:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).send('Too many attempts — please wait a minute and try again.');
  }
  const appId = process.env.META_APP_ID;
  const baseUrl = normalizeBaseUrl(process.env.APP_BASE_URL);
  if(!appId || !baseUrl){
    return res.status(500).send('META_APP_ID and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-meta`;
  const scope = ['pages_show_list', 'pages_read_engagement'].join(',');
  // CSRF protection: a random state tied to a short-lived HttpOnly cookie —
  // the callback below refuses to proceed unless they match, so a stranger
  // can't trick your browser into "connecting" an account they control.
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'pf_oauth_state_meta', state, { maxAgeSeconds: 600 });
  const url = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}

async function handleCallback(req, res){
  const { code, error, state } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_denied` });
    return res.end();
  }

  const cookies = parseCookies(req);
  if(!state || !cookies.pf_oauth_state_meta || state !== cookies.pf_oauth_state_meta){
    console.error('Meta OAuth state mismatch — possible CSRF attempt or expired flow.');
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_error` });
    return res.end();
  }

  // Same browser, same session — the cookie is still present on this
  // redirect-back request, so we can re-verify who this connection
  // actually belongs to rather than trusting anything in the query string.
  let decoded;
  try{
    decoded = await verifySession(req);
  }catch(err){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_error` });
    return res.end();
  }

  try{
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = normalizeBaseUrl(process.env.APP_BASE_URL);
    const redirectUri = `${baseUrl}/api/oauth-meta`;

    const tokenRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
    const tokenData = await tokenRes.json();
    if(tokenData.error) throw new Error(tokenData.error.message);

    const longRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
    const longData = await longRes.json();
    if(longData.error) throw new Error(longData.error.message);

    const pagesRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${longData.access_token}`);
    const pagesData = await pagesRes.json();
    if(pagesData.error) throw new Error(pagesData.error.message);
    const page = (pagesData.data||[])[0];
    if(!page) throw new Error('No Facebook Page found — make sure you are an admin of a Page.');

    await setConnection(decoded.uid, 'meta', {
      pageAccessToken: page.access_token,
      pageId: page.id,
      pageName: page.name,
      connectedAt: Date.now()
    });
    await logEvent('meta_connected', { uid: decoded.uid, detail: page.name });

    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_success` });
    res.end();
  }catch(err){
    console.error(err);
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_error` });
    res.end();
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.query.code || req.query.error){
    return handleCallback(req, res);
  }
  return handleStart(req, res);
};
