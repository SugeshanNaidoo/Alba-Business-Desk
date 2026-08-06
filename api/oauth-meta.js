// Combined start + callback for the Meta (Instagram + Facebook) OAuth flow,
// kept as one function instead of two to stay within Vercel Hobby's
// serverless function limit. Same URL serves both roles:
//   (no code param)            → redirects into Meta's consent screen (the "start")
//   ?code=... (or ?error=...) → Meta's redirect back after approval/denial (the "callback")
// Register THIS url as the app's OAuth redirect URI in Meta's dashboard:
//   {APP_BASE_URL}/api/oauth-meta
//
// The "start" step requires a genuine signed-in session (the same HttpOnly
// session cookie billing uses) — no shared secret to configure or leak.
// Only someone actually signed into this CRM can trigger a connection.

const { setCors, parseCookies, setCookie } = require('../lib/util');
const { setConnection } = require('../lib/tokenStore');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');
const crypto = require('crypto');

const GRAPH_VERSION = 'v22.0';

async function handleStart(req, res){
  try{
    await verifySession(req);
  }catch(err){
    return res.status(err.status||401).send('You need to be signed in to connect a social account. Go back to the CRM, sign in with Google, and try again.');
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`oauth-meta-start:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).send('Too many attempts — please wait a minute and try again.');
  }
  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.APP_BASE_URL;
  if(!appId || !baseUrl){
    return res.status(500).send('META_APP_ID and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-meta`;
  const scope = [
    'pages_show_list', 'pages_read_engagement',
    'instagram_basic', 'instagram_manage_insights'
  ].join(',');
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

  try{
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
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

    let igUserId = null, igUsername = null;
    try{
      const igRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`);
      const igData = await igRes.json();
      if(igData.instagram_business_account){
        igUserId = igData.instagram_business_account.id;
        igUsername = igData.instagram_business_account.username;
      }
    }catch(e){ /* Page has no linked Instagram yet — Facebook sync still works fine */ }

    await setConnection('meta', {
      pageAccessToken: page.access_token,
      pageId: page.id,
      pageName: page.name,
      igUserId, igUsername,
      connectedAt: Date.now()
    });
    await logEvent('meta_connected', { detail: page.name });

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
