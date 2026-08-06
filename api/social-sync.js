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
const { getConnection } = require('../lib/tokenStore');
const { getDb } = require('../lib/firebaseAdmin');
const { fetchInstagram, fetchFacebook, fetchTikTok } = require('../lib/platformFetchers');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');
const { isUserSubscribed } = require('../lib/subscriptionCheck');

function newId(prefix){ return prefix + Date.now() + Math.floor(Math.random()*100000); }

function mergePlatformData(crmData, platformName, result){
  const platform = crmData.socialPlatforms.find(p=>p.name===platformName);
  if(!platform) return;
  if(typeof result.followers === 'number'){
    platform.followers = result.followers;
    crmData.socialSnapshots.push({ id: newId('ss'), platformId: platform.id, followers: result.followers, date: new Date().toISOString().slice(0,10) });
  }
  (result.posts||[]).forEach(p=>{
    const exists = crmData.socialPosts.some(sp=>sp.externalId && sp.externalId===p.externalId && sp.platformId===platform.id);
    if(exists) return;
    crmData.socialPosts.push({
      id: newId('post'), platformId: platform.id, externalId: p.externalId,
      caption: p.caption||'', postedAt: p.postedAt||new Date().toISOString(),
      likes: p.likes||0, comments: p.comments||0, shares: p.shares||0, reach: p.reach||null,
      createdAt: Date.now()
    });
  });
  (result.mentions||[]).forEach(m=>{
    const exists = crmData.socialMentions.some(sm=>sm.externalId && sm.externalId===m.externalId && sm.platformId===platform.id);
    if(exists) return;
    crmData.socialMentions.push({
      id: newId('m'), platformId: platform.id, externalId: m.externalId,
      account: m.account||'Unknown', note: m.note||'', url: m.url||'',
      date: m.date||new Date().toISOString().slice(0,10), createdAt: Date.now()
    });
  });
}

async function handlePlatformSync(req, res){
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: 'You need to be signed in to sync social data.' }); }
  if(!(await isUserSubscribed(decoded.uid))){
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
    const data = await fn(decoded.uid);
    return res.status(200).json(data);
  }catch(err){
    console.error(`Sync failed for uid=${decoded.uid} platform=${req.query.platform}:`, err.message, err.stack ? '\n'+err.stack : '');
    return res.status(502).json({ error: err.message });
  }
}

async function handleStatus(req, res){
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  try{
    const meta = await getConnection(decoded.uid, 'meta').catch(()=>null);
    const instagram = await getConnection(decoded.uid, 'instagram').catch(()=>null);
    const tiktok = await getConnection(decoded.uid, 'tiktok').catch(()=>null);
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
      const uid = subDoc.id;
      try{
        const docRef = db.collection('flowline_crm_users').doc(uid);
        const doc = await docRef.get();
        if(!doc.exists || !doc.data().payload){
          results.push({ uid, skipped: true, reason: 'No CRM data yet' });
          continue;
        }
        const crmData = JSON.parse(doc.data().payload);
        crmData.socialPlatforms = crmData.socialPlatforms || [];
        crmData.socialSnapshots = crmData.socialSnapshots || [];
        crmData.socialPosts = crmData.socialPosts || [];
        crmData.socialMentions = crmData.socialMentions || [];

        const errors = [];
        try{ mergePlatformData(crmData, 'Instagram', await fetchInstagram(uid)); } catch(e){ errors.push('Instagram: ' + e.message); }
        try{ mergePlatformData(crmData, 'Facebook', await fetchFacebook(uid)); } catch(e){ errors.push('Facebook: ' + e.message); }
        try{ mergePlatformData(crmData, 'TikTok', await fetchTikTok(uid)); } catch(e){ errors.push('TikTok: ' + e.message); }

        await docRef.set({ payload: JSON.stringify(crmData), updatedAt: Date.now() }, { merge: true });
        results.push({ uid, ok: true, errors });
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
  if(req.query.action === 'scheduled') return handleScheduled(req, res);
  if(req.query.platform) return handlePlatformSync(req, res);
  return res.status(400).json({ error: 'Specify ?platform=instagram|facebook|tiktok or ?action=status|scheduled' });
};
