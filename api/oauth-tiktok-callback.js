// TikTok redirects here after the user approves (or denies) the connection
// request. Exchanges the authorization code for an access + refresh token
// pair and stores the refresh token for future syncs (access tokens expire
// every 24 hours, so only the refresh token is worth persisting).

const { setCors } = require('./_util');
const { setConnection } = require('./_tokenStore');

module.exports = async (req, res) => {
  setCors(res);
  const { code, error } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=tiktok_denied` });
    return res.end();
  }
  if(!code){
    return res.status(400).send('Missing authorization code.');
  }

  try{
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
    const redirectUri = `${baseUrl}/api/oauth-tiktok-callback`;

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
};
