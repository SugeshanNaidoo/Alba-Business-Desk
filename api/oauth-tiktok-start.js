// Kicks off the TikTok OAuth flow, gated by the same shared CONNECT_SECRET
// as the Meta flow. See oauth-meta-start.js for why the secret exists.

const { setCors } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  const { secret } = req.query;
  if(!process.env.CONNECT_SECRET || secret !== process.env.CONNECT_SECRET){
    return res.status(403).send('Invalid or missing connect secret.');
  }
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const baseUrl = process.env.APP_BASE_URL;
  if(!clientKey || !baseUrl){
    return res.status(500).send('TIKTOK_CLIENT_KEY and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-tiktok-callback`;
  const scope = ['user.info.basic', 'user.info.stats', 'video.list'].join(',');
  const state = Math.random().toString(36).slice(2);
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${encodeURIComponent(clientKey)}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
};
