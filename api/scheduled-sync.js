// Runs on a schedule (see vercel.json) so follower counts and recent posts
// stay current without anyone needing to open the CRM and click "Sync now".
//
// Requires:
//   CRM_OWNER_UID — the Firebase UID of the Google account your CRM data is
//                   synced to. Settings → Account in the CRM shows this once
//                   you're signed in.
//   FIREBASE_SERVICE_ACCOUNT — see README.md.
//
// Vercel automatically protects scheduled invocations with a CRON_SECRET it
// provisions for you — this checks that header so nobody else can trigger
// your sync by guessing the URL.
//
// Known limitation: this reads the workspace's stored data, merges in fresh
// social data, and writes it back as a whole. If someone is actively editing
// the CRM in a browser tab at the exact moment this runs, last write wins —
// fine for a daily sync on a small team, worth knowing about regardless.

const { getDb } = require('./_firebaseAdmin');
const { fetchInstagram, fetchFacebook, fetchTikTok } = require('./_platformFetchers');

function uid(prefix){ return prefix + Date.now() + Math.floor(Math.random()*100000); }

function mergePlatformData(crmData, platformName, result){
  const platform = crmData.socialPlatforms.find(p=>p.name===platformName);
  if(!platform) return; // this workspace hasn't added that platform card yet — nothing to merge into

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

module.exports = async (req, res) => {
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
    try{ mergePlatformData(crmData, 'Instagram', await fetchInstagram()); }
    catch(e){ errors.push('Instagram: ' + e.message); }
    try{ mergePlatformData(crmData, 'Facebook', await fetchFacebook()); }
    catch(e){ errors.push('Facebook: ' + e.message); }
    try{ mergePlatformData(crmData, 'TikTok', await fetchTikTok()); }
    catch(e){ errors.push('TikTok: ' + e.message); }

    await docRef.set({ payload: JSON.stringify(crmData), updatedAt: Date.now() }, { merge: true });

    return res.status(200).json({ ok: true, errors });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
