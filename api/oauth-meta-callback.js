// Meta redirects here after the user approves (or denies) the connection
// request. Exchanges the authorization code for a long-lived token, finds
// the user's Facebook Page and its linked Instagram Business account, and
// stores everything needed for future syncs.

const { setCors } = require('./_util');
const { setConnection } = require('./_tokenStore');

const GRAPH_VERSION = 'v22.0';

module.exports = async (req, res) => {
  setCors(res);
  const { code, error } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_denied` });
    return res.end();
  }
  if(!code){
    return res.status(400).send('Missing authorization code.');
  }

  try{
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
    const redirectUri = `${baseUrl}/api/oauth-meta-callback`;

    // 1. Exchange the code for a short-lived user token
    const tokenRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
    const tokenData = await tokenRes.json();
    if(tokenData.error) throw new Error(tokenData.error.message);

    // 2. Exchange for a long-lived user token (~60 days)
    const longRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
    const longData = await longRes.json();
    if(longData.error) throw new Error(longData.error.message);

    // 3. Find the user's Facebook Page (assumes one Page — see README if you manage several)
    const pagesRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${longData.access_token}`);
    const pagesData = await pagesRes.json();
    if(pagesData.error) throw new Error(pagesData.error.message);
    const page = (pagesData.data||[])[0];
    if(!page) throw new Error('No Facebook Page found — make sure you are an admin of a Page.');

    // 4. Find the Instagram Business account linked to that Page, if any
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

    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_success` });
    res.end();
  }catch(err){
    console.error(err);
    res.writeHead(302, { Location: `${crmUrl}?social_connect=meta_error` });
    res.end();
  }
};
