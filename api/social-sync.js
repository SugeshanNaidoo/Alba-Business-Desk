// One function covering everything social-data related, routed by query
// params, to stay within Vercel Hobby's serverless function limit:
//   ?platform=instagram | facebook | tiktok   → on-demand sync for that platform
//   ?action=status                            → connection status (used by Settings)
//   ?action=scheduled                         → the daily cron job (see vercel.json)

const { setCors } = require('../lib/util');
const { getConnection } = require('../lib/tokenStore');
const { getDb } = require('../lib/firebaseAdmin');
const { fetchInstagram, fetchFacebook, fetchTikTok } = require('../lib/platformFetchers');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/auditLog');
const { verifySession } = require('../lib/session');

function uid(prefix){ return prefix + Date.now() + Math.floor(Math.random()*100000); }

function mergePlatformData(crmData, platformName, result){
  const platform = crmData.socialPlatforms.find(p=>p.name===platformName);
  if(!platform) return;
  if(typeof result.followers === 'number'){
    platform.followers = result.followers;
    crmData.socialSnapshots.push({ id: uid('ss'), platformId: platform.id, followers: result.followers, date: new Date().toISOString().slice(0,10) });
  }
  (result.posts||[]).forEach(p=>{
    const exists = crmData.socialPosts.some(sp=>sp.externalId && sp.externalId===p.externalId && sp.platformId===platform.id);
    if(exists) return;
    crmData.socialPosts.push({
      id: uid('post'), platformId: platform.id, externalId: p.externalId,
      caption: p.caption||'', postedAt: p.postedAt||new Date().toISOString(),
      likes: p.likes||0, comments: p.comments||0, shares: p.shares||0, reach: p.reach||null,
      createdAt: Date.now()
    });
  });
  (result.mentions||[]).forEach(m=>{
    const exists = crmData.socialMentions.some(sm=>sm.externalId && sm.externalId===m.externalId && sm.platformId===platform.id);
    if(exists) return;
    crmData.socialMentions.push({
      id: uid('m'), platformId: platform.id, externalId: m.externalId,
      account: m.account||'Unknown', note: m.note||'', url: m.url||'',
      date: m.date||new Date().toISOString().slice(0,10), createdAt: Date.now()
    });
  });
}

async function handlePlatformSync(req, res){
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try{ await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: 'You need to be signed in to sync social data.' }); }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`sync:${ip}`, { limit: 20, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many sync requests — please wait a minute and try again.' });
  }
  const fetchers = { instagram: fetchInstagram, facebook: fetchFacebook, tiktok: fetchTikTok };
  const fn = fetchers[req.query.platform];
  if(!fn) return res.status(400).json({ error: 'Unknown platform. Use ?platform=instagram, facebook, or tiktok.' });
  try{
    const data = await fn();
    return res.status(200).json(data);
  }catch(err){
    console.error(`Sync failed for platform=${req.query.platform}:`, err.message, err.stack ? '\n'+err.stack : '');
    return res.status(502).json({ error: err.message });
  }
}

async function handleStatus(req, res){
  try{
    const meta = await getConnection('meta').catch(()=>null);
    const instagram = await getConnection('instagram').catch(()=>null);
    const tiktok = await getConnection('tiktok').catch(()=>null);
    res.status(200).json({
      meta: meta ? { connected:true, pageName: meta.pageName||'' } : { connected:false },
      instagram: instagram ? { connected:true, username: instagram.username||'' } : { connected:false },
      tiktok: tiktok ? { connected:true, displayName: tiktok.displayName||'' } : { connected:false }
    });
  }catch(err){
    res.status(200).json({
      meta: { connected:false }, instagram: { connected:false }, tiktok: { connected:false },
      note: 'Could not reach Firestore — check FIREBASE_SERVICE_ACCOUNT, or this deployment may be using env-var-only configuration.'
    });
  }
}

async function handleScheduled(req, res){
  const authHeader = req.headers['authorization'];
  if(process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`){
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ownerUid = process.env.CRM_OWNER_UID;
  if(!ownerUid){
    return res.status(500).json({ error: 'CRM_OWNER_UID is not set — see README.md.' });
  }
  try{
    const db = getDb();
    const docRef = db.collection('flowline_crm_users').doc(ownerUid);
    const doc = await docRef.get();
    if(!doc.exists || !doc.data().payload){
      return res.status(404).json({ error: 'No CRM data found for this workspace yet — sign in and use "Sync now" from the browser at least once first.' });
    }
    const crmData = JSON.parse(doc.data().payload);
    crmData.socialPlatforms = crmData.socialPlatforms || [];
    crmData.socialSnapshots = crmData.socialSnapshots || [];
    crmData.socialPosts = crmData.socialPosts || [];
    crmData.socialMentions = crmData.socialMentions || [];

    const errors = [];
    try{ mergePlatformData(crmData, 'Instagram', await fetchInstagram()); } catch(e){ errors.push('Instagram: ' + e.message); }
    try{ mergePlatformData(crmData, 'Facebook', await fetchFacebook()); } catch(e){ errors.push('Facebook: ' + e.message); }
    try{ mergePlatformData(crmData, 'TikTok', await fetchTikTok()); } catch(e){ errors.push('TikTok: ' + e.message); }

    await docRef.set({ payload: JSON.stringify(crmData), updatedAt: Date.now() }, { merge: true });
    return res.status(200).json({ ok: true, errors });
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
