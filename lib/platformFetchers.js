// One fetch function per platform, shared by the on-demand /api/*-sync
// endpoints and the scheduled cron job, so the actual API-calling logic
// only exists in one place.
//
// Each function first looks for a connection stored in Firestore (set up via
// the "Connect..." OAuth flow in Settings). If none is found, it falls back
// to the older env-var-only setup, so existing deployments keep working.

const { getConnection, setConnection } = require('./tokenStore');
const GRAPH_VERSION = 'v22.0';

async function fetchInstagram(){
  let token, igUserId;
  const conn = await getConnection('meta').catch(()=>null);
  if(conn && conn.pageAccessToken && conn.igUserId){
    token = conn.pageAccessToken;
    igUserId = conn.igUserId;
  }
  if(!token || !igUserId){
    token = process.env.IG_ACCESS_TOKEN;
    igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  }
  if(!token || !igUserId){
    throw new Error('Instagram is not connected. Use "Connect Instagram & Facebook" in Settings, or set IG_ACCESS_TOKEN and IG_BUSINESS_ACCOUNT_ID.');
  }

  const profileRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}?fields=followers_count,username&access_token=${token}`);
  const profile = await profileRes.json();
  if(profile.error) throw new Error(profile.error.message);

  const mediaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media?fields=id,caption,timestamp,like_count,comments_count,permalink&limit=25&access_token=${token}`);
  const media = await mediaRes.json();
  if(media.error) throw new Error(media.error.message);

  const posts = (media.data||[]).map(m=>({
    externalId: m.id,
    caption: (m.caption||'').slice(0,200),
    postedAt: m.timestamp,
    likes: m.like_count||0,
    comments: m.comments_count||0,
    shares: 0,
    reach: null,
    url: m.permalink||''
  }));

  let mentions = [];
  try{
    const mentionsRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/mentioned_media?fields=id,caption,timestamp,username&limit=25&access_token=${token}`);
    const mentionsData = await mentionsRes.json();
    if(!mentionsData.error){
      mentions = (mentionsData.data||[]).map(m=>({
        externalId: m.id,
        account: m.username ? `@${m.username}` : 'Unknown account',
        note: (m.caption||'').slice(0,200),
        date: (m.timestamp||'').slice(0,10),
        url: ''
      }));
    }
  }catch(e){ /* optional, permission-gated */ }

  return { followers: profile.followers_count||0, posts, mentions };
}

async function fetchFacebook(){
  let token, pageId;
  const conn = await getConnection('meta').catch(()=>null);
  if(conn && conn.pageAccessToken && conn.pageId){
    token = conn.pageAccessToken;
    pageId = conn.pageId;
  }
  if(!token || !pageId){
    token = process.env.FB_PAGE_ACCESS_TOKEN;
    pageId = process.env.FB_PAGE_ID;
  }
  if(!token || !pageId){
    throw new Error('Facebook is not connected. Use "Connect Instagram & Facebook" in Settings, or set FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID.');
  }

  const pageRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}?fields=fan_count,name&access_token=${token}`);
  const page = await pageRes.json();
  if(page.error) throw new Error(page.error.message);

  const postsRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&limit=25&access_token=${token}`);
  const postsData = await postsRes.json();
  if(postsData.error) throw new Error(postsData.error.message);

  const posts = (postsData.data||[]).map(p=>({
    externalId: p.id,
    caption: (p.message||'').slice(0,200),
    postedAt: p.created_time,
    likes: p.likes && p.likes.summary ? p.likes.summary.total_count : 0,
    comments: p.comments && p.comments.summary ? p.comments.summary.total_count : 0,
    shares: p.shares ? p.shares.count : 0,
    reach: null,
    url: ''
  }));

  return { followers: page.fan_count||0, posts, mentions: [] };
}

async function fetchTikTok(){
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if(!clientKey || !clientSecret){
    throw new Error('TikTok is not configured on this server. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.');
  }

  let refreshToken, usingStoredConnection = false;
  const conn = await getConnection('tiktok').catch(()=>null);
  if(conn && conn.refreshToken){ refreshToken = conn.refreshToken; usingStoredConnection = true; }
  if(!refreshToken) refreshToken = process.env.TIKTOK_REFRESH_TOKEN;
  if(!refreshToken){
    throw new Error('TikTok is not connected. Use "Connect TikTok" in Settings, or set TIKTOK_REFRESH_TOKEN.');
  }

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  const tokenData = await tokenRes.json();
  if(!tokenData.access_token){
    throw new Error(tokenData.error_description || 'Could not refresh the TikTok access token — it may need reconnecting.');
  }
  const accessToken = tokenData.access_token;

  if(usingStoredConnection && tokenData.refresh_token){
    // TikTok rotates refresh tokens on every use — keep Firestore current
    try{ await setConnection('tiktok', { refreshToken: tokenData.refresh_token }); }catch(e){}
  }

  const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const profileData = await profileRes.json();
  const user = profileData.data && profileData.data.user;
  const followers = user && typeof user.follower_count === 'number' ? user.follower_count : null;

  const videosRes = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,like_count,comment_count,share_count,view_count', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_count: 20 })
  });
  const videosData = await videosRes.json();
  const list = (videosData.data && videosData.data.videos) || [];

  const posts = list.map(v=>({
    externalId: v.id,
    caption: (v.title||'').slice(0,200),
    postedAt: v.create_time ? new Date(v.create_time*1000).toISOString() : null,
    likes: v.like_count||0,
    comments: v.comment_count||0,
    shares: v.share_count||0,
    reach: typeof v.view_count === 'number' ? v.view_count : null,
    url: v.share_url||''
  }));

  return { followers, followersAvailable: followers!==null, posts, mentions: [] };
}

module.exports = { fetchInstagram, fetchFacebook, fetchTikTok };
