// Combined start + callback for the TikTok OAuth flow — same reasoning as
// oauth-meta.js. Register THIS url as TikTok's redirect URI:
//   {APP_BASE_URL}/api/oauth-tiktok

const { setCors } = require('../lib/util');
const { setConnection } = require('../lib/tokenStore');

async function handleStart(req, res){
  const { secret } = req.query;
  if(!process.env.CONNECT_SECRET || secret !== process.env.CONNECT_SECRET){
    return res.status(403).send('Invalid or missing connect secret.');
  }
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const baseUrl = process.env.APP_BASE_URL;
  if(!clientKey || !baseUrl){
    return res.status(500).send('TIKTOK_CLIENT_KEY and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-tiktok`;
  const scope = ['user.info.basic', 'user.info.stats', 'video.list'].join(',');
  const state = Math.random().toString(36).slice(2);
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${encodeURIComponent(clientKey)}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}

async function handleCallback(req, res){
  const { code, error } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=tiktok_denied` });
    return res.end();
  }

  try{
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
    const redirectUri = `${baseUrl}/api/oauth-tiktok`;

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey, client_secret: clientSecret,
        code, grant_type: 'authorization_code', redirect_uri: redirectUri
      })
    });
    const tokenData = await tokenRes.json();
    if(!tokenData.access_token) throw new Error(tokenData.error_description || 'Could not exchange the authorization code.');

    let displayName = '';
    try{
      const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profileData = await profileRes.json();
      displayName = profileData.data && profileData.data.user ? profileData.data.user.display_name : '';
    }catch(e){ /* cosmetic only */ }

    await setConnection('tiktok', {
      refreshToken: tokenData.refresh_token,
      openId: tokenData.open_id,
      displayName,
      connectedAt: Date.now()
    });

    res.writeHead(302, { Location: `${crmUrl}?social_connect=tiktok_success` });
    res.end();
  }catch(err){
    console.error(err);
    res.writeHead(302, { Location: `${crmUrl}?social_connect=tiktok_error` });
    res.end();
  }
}

module.exports = async (req, res) => {
  setCors(res);
  if(req.query.code || req.query.error){
    return handleCallback(req, res);
  }
  return handleStart(req, res);
};
