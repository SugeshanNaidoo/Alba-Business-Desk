// Start + callback for Instagram's own login flow — genuinely separate
// from Facebook's now. Meta retired Instagram access via Facebook Login
// in January 2025; this is the current, correct replacement ("Instagram
// API with Instagram Login" / "Business Login for Instagram"). Notably,
// this does NOT require a linked Facebook Page at all anymore.
//
// Register THIS url as the redirect URI under your Meta App's Instagram
// product → "Business login" settings (a separate settings screen from
// Facebook Login for Business):
//   {APP_BASE_URL}/api/oauth-instagram
//
// Uses the same META_APP_ID / META_APP_SECRET as the Facebook flow — in
// Meta's dashboard, Instagram is a separate *product* configured within
// the same App, not a separate App with its own credentials.

const { setCors, parseCookies, setCookie } = require('../lib/util');
const { setConnection } = require('../lib/tokenStore');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');
const crypto = require('crypto');

async function handleStart(req, res){
  try{
    await verifySession(req);
  }catch(err){
    return res.status(err.status||401).send('You need to be signed in to connect a social account. Go back to the CRM, sign in with Google, and try again.');
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`oauth-instagram-start:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).send('Too many attempts — please wait a minute and try again.');
  }
  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.APP_BASE_URL;
  if(!appId || !baseUrl){
    return res.status(500).send('META_APP_ID and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-instagram`;
  // Just what the sync actually uses — basic profile/media read plus
  // insights. Not requesting content publishing, comment moderation, or
  // messaging, since this integration never does any of those.
  const scope = ['instagram_business_basic', 'instagram_business_manage_insights'].join(',');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'pf_oauth_state_instagram', state, { maxAgeSeconds: 600 });
  const url = `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}

async function handleCallback(req, res){
  const { code, error, state } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=instagram_denied` });
    return res.end();
  }
  const cookies = parseCookies(req);
  if(!state || !cookies.pf_oauth_state_instagram || state !== cookies.pf_oauth_state_instagram){
    console.error('Instagram OAuth state mismatch — possible CSRF attempt or expired flow.');
    res.writeHead(302, { Location: `${crmUrl}?social_connect=instagram_error` });
    return res.end();
  }

  try{
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
    const redirectUri = `${baseUrl}/api/oauth-instagram`;

    // Instagram's token exchange is form-POST, not query-string GET like
    // Facebook's — and the response is wrapped in a `data` array, which is
    // easy to miss if you're used to Facebook's flatter response shape.
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId, client_secret: appSecret,
        grant_type: 'authorization_code', redirect_uri: redirectUri, code
      })
    });
    const tokenJson = await tokenRes.json();
    const shortLived = tokenJson.data ? tokenJson.data[0] : tokenJson;
    if(!shortLived || !shortLived.access_token){
      throw new Error((tokenJson.error_message) || 'Instagram did not return an access token.');
    }

    // Exchange for a long-lived token (~60 days, refreshable) so this
    // doesn't need reconnecting constantly.
    let accessToken = shortLived.access_token;
    let expiresAt = null;
    try{
      const longRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortLived.access_token)}`);
      const longData = await longRes.json();
      if(longData.access_token){
        accessToken = longData.access_token;
        expiresAt = Date.now() + (longData.expires_in || 5184000) * 1000; // ~60 days
      }
    }catch(e){
      console.error('Could not exchange for a long-lived Instagram token, continuing with the short-lived one:', e.message);
    }

    let username = '';
    try{
      const profRes = await fetch(`https://graph.instagram.com/me?fields=username&access_token=${encodeURIComponent(accessToken)}`);
      const prof = await profRes.json();
      username = prof.username || '';
    }catch(e){ /* cosmetic only */ }

    await setConnection('instagram', {
      accessToken,
      igUserId: shortLived.user_id,
      username,
      expiresAt,
      connectedAt: Date.now()
    });
    await logEvent('instagram_connected', { detail: username });

    res.writeHead(302, { Location: `${crmUrl}?social_connect=instagram_success` });
    res.end();
  }catch(err){
    console.error(err);
    res.writeHead(302, { Location: `${crmUrl}?social_connect=instagram_error` });
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
