// One function covering everything social-data related, routed by query
// params, to stay within Vercel Hobby's serverless function limit:
//   ?platform=instagram | facebook | tiktok   → on-demand sync for that platform
//   ?action=status                            → connection status (used by Settings)
//   ?action=scheduled                         → the daily cron job (see vercel.json)
//
// Every connection and every synced data set belongs to one signed-in
// customer — not shared workspace-wide — and syncing requires an active
// subscription, same as any other real functionality in the CRM.

const { setCors } = require('../lib/util');
const { getConnection, deleteConnection } = require('../lib/tokenStore');
const { getDb } = require('../lib/firebaseAdmin');
const { fetchInstagram, fetchFacebook, fetchTikTok } = require('../lib/platformFetchers');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');
const { resolveOrgContext, roleAtLeast } = require('../lib/orgContext');
const { isUserSubscribed } = require('../lib/subscriptionCheck');



async function handlePlatformSync(req, res){
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req); }
  catch(err){ return res.status(err.status||401).json({ error: 'You need to be signed in to sync social data.' }); }
  if(!(await isUserSubscribed(ctx.organisation.ownerId || ctx.uid))){
    return res.status(402).json({ error: 'An active subscription is needed to sync social data.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`sync:${ip}`, { limit: 20, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many sync requests — please wait a minute and try again.' });
  }
  const fetchers = { instagram: fetchInstagram, facebook: fetchFacebook, tiktok: fetchTikTok };
  const fn = fetchers[req.query.platform];
  if(!fn) return res.status(400).json({ error: 'Unknown platform. Use ?platform=instagram, facebook, or tiktok.' });
  try{
    const data = await fn(ctx.orgId);
    return res.status(200).json(data);
  }catch(err){
    console.error(`Sync failed for org=${ctx.orgId} platform=${req.query.platform}:`, err.message, err.stack ? '\n'+err.stack : '');
    return res.status(502).json({ error: err.message });
  }
}

// Disconnect a connected social platform. Where the provider supports
// programmatic revocation we ask them to revoke too, so access genuinely
// ends rather than us simply forgetting the token.
async function handleDisconnect(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let ctx;
  try{ ctx = await resolveOrgContext(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  if(!roleAtLeast(ctx.role, 'admin')){
    return res.status(403).json({ error: 'Only an owner or admin can disconnect integrations.' });
  }
  const platform = req.query.platform;
  if(!['meta','instagram','tiktok'].includes(platform)){
    return res.status(400).json({ error: 'Unknown platform.' });
  }
  try{
    const conn = await getConnection(ctx.orgId, platform);
    if(conn){
      try{
        if(platform === 'meta' && conn.pageAccessToken){
          // Graph API: DELETE /me/permissions revokes the whole grant.
          await fetch(`https://graph.facebook.com/v22.0/me/permissions?access_token=${encodeURIComponent(conn.pageAccessToken)}`, { method:'DELETE' });
        } else if(platform === 'tiktok' && conn.refreshToken){
          await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
            method:'POST',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_key: process.env.TIKTOK_CLIENT_KEY || '',
              client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
              token: conn.refreshToken
            })
          });
        }
        // Instagram's Business Login has no documented programmatic revoke
        // endpoint — the user revokes from Instagram's own app settings.
        // Deleting our stored token still ends our access immediately.
      }catch(e){
        console.error(`Revoke call failed for ${platform} (continuing to delete locally):`, e.message);
      }
    }
    await deleteConnection(ctx.orgId, platform);
    await logEvent(`${platform}_disconnected`, { uid: ctx.uid, orgId: ctx.orgId });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not disconnect.' });
  }
}

async function handleStatus(req, res){
  let ctx;
  try{ ctx = await resolveOrgContext(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  try{
    const meta = await getConnection(ctx.orgId, 'meta').catch(()=>null);
    const instagram = await getConnection(ctx.orgId, 'instagram').catch(()=>null);
    const tiktok = await getConnection(ctx.orgId, 'tiktok').catch(()=>null);
    res.status(200).json({
      meta: meta ? { connected:true, pageName: meta.pageName||'' } : { connected:false },
      instagram: instagram ? { connected:true, username: instagram.username||'' } : { connected:false },
      tiktok: tiktok ? { connected:true, displayName: tiktok.displayName||'' } : { connected:false }
    });
  }catch(err){
    res.status(200).json({
      meta: { connected:false }, instagram: { connected:false }, tiktok: { connected:false },
      note: 'Could not reach Firestore — check FIREBASE_SERVICE_ACCOUNT.'
    });
  }
}

// Runs for every account with an active subscription, syncing each one's
// own connected platforms into their own CRM data — not a single shared
// workspace anymore.
async function handleScheduled(req, res){
  const authHeader = req.headers['authorization'];
  if(process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`){
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try{
    const db = getDb();
    const activeSubs = await db.collection('subscriptions').where('status', '==', 'active').get();
    if(activeSubs.empty){
      return res.status(200).json({ ok: true, accountsProcessed: 0, note: 'No active subscriptions to sync.' });
    }

    const results = [];
    for(const subDoc of activeSubs.docs){
      // subscriptions/{uid} is keyed on the OWNER's uid (PayFast binds it
      // there), so this resolves owner -> organisation.
      const uid = subDoc.id;
      try{
        const userSnap = await db.collection('users').doc(uid).get();
        const orgId = userSnap.exists ? userSnap.data().activeOrganisationId : null;
        if(!orgId){ results.push({ uid, skipped:true, reason:'No organisation' }); continue; }
        const orgRef = db.collection('organisations').doc(orgId);
        // Load the org's platform cards so fetched data can be attached to
        // the right one.
        const platSnap = await orgRef.collection('socialAccounts').get();
        const platforms = platSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if(!platforms.length){
          results.push({ uid, skipped: true, reason: 'No social platforms configured' });
          continue;
        }

        const errors = [];
        const fetchers = { Instagram: fetchInstagram, Facebook: fetchFacebook, TikTok: fetchTikTok };
        let writes = 0;

        for(const [platformName, fetcher] of Object.entries(fetchers)){
          const platform = platforms.find(p => p.name === platformName);
          if(!platform) continue;
          try{
            const result = await fetcher(orgId);   // connections are org-owned
            const batch = db.batch();

            if(typeof result.followers === 'number'){
              batch.set(orgRef.collection('socialAccounts').doc(platform.id),
                { followers: result.followers, updatedAt: Date.now() }, { merge: true });
              const snapId = `ss_${platform.id}_${new Date().toISOString().slice(0,10)}`;
              batch.set(orgRef.collection('socialSnapshots').doc(snapId),
                { id: snapId, platformId: platform.id, followers: result.followers,
                  date: new Date().toISOString().slice(0,10) }, { merge: true });
              writes += 2;
            }
            // externalId as the document id makes re-syncing idempotent —
            // the same post updates in place instead of duplicating.
            (result.posts || []).forEach(post => {
              if(!post.externalId) return;
              const id = `post_${platform.id}_${post.externalId}`;
              batch.set(orgRef.collection('socialPosts').doc(id), {
                id, platformId: platform.id, externalId: post.externalId,
                caption: post.caption || '', postedAt: post.postedAt || new Date().toISOString(),
                likes: post.likes || 0, comments: post.comments || 0,
                shares: post.shares || 0, reach: post.reach || null,
                updatedAt: Date.now()
              }, { merge: true });
              writes++;
            });
            (result.mentions || []).forEach(m => {
              if(!m.externalId) return;
              const id = `m_${platform.id}_${m.externalId}`;
              batch.set(orgRef.collection('socialMentions').doc(id), {
                id, platformId: platform.id, externalId: m.externalId,
                account: m.account || 'Unknown', note: m.note || '', url: m.url || '',
                date: m.date || new Date().toISOString().slice(0,10),
                updatedAt: Date.now()
              }, { merge: true });
              writes++;
            });

            await batch.commit();
          }catch(e){ errors.push(`${platformName}: ${e.message}`); }
        }

        results.push({ uid, ok: true, writes, errors });
      }catch(e){
        console.error(`Scheduled sync failed for uid=${uid}:`, e.message);
        results.push({ uid, ok: false, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, accountsProcessed: results.length, results });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if(req.query.action === 'status') return handleStatus(req, res);
  if(req.query.action === 'disconnect') return handleDisconnect(req, res);
  if(req.query.action === 'scheduled') return handleScheduled(req, res);
  if(req.query.platform) return handlePlatformSync(req, res);
  return res.status(400).json({ error: 'Specify ?platform=instagram|facebook|tiktok or ?action=status|scheduled' });
};
