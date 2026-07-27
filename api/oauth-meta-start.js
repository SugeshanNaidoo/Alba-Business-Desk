// Kicks off the Meta (Instagram + Facebook) OAuth flow. Visiting this URL
// redirects to Meta's own consent screen; approving it lands the user back
// at oauth-meta-callback.js, which stores the resulting token.
//
// Gated by a shared secret (CONNECT_SECRET) so a random visitor can't
// connect their own Instagram/Facebook to your CRM's backend — only someone
// who has the secret (i.e., you, pasted into Settings) can trigger this.

const { setCors } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  const { secret } = req.query;
  if(!process.env.CONNECT_SECRET || secret !== process.env.CONNECT_SECRET){
    return res.status(403).send('Invalid or missing connect secret.');
  }
  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.APP_BASE_URL;
  if(!appId || !baseUrl){
    return res.status(500).send('META_APP_ID and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/oauth-meta-callback`;
const scope = [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_insights',
  'business_management'
].join(',');
  const url = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code`;
  res.writeHead(302, { Location: url });
  res.end();
};
