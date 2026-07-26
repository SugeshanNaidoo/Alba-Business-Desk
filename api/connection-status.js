// Read-only status check the CRM's Settings page calls to show whether
// Instagram/Facebook and TikTok are currently connected — never returns
// the tokens themselves, just enough to render a status line.

const { setCors } = require('./_util');
const { getConnection } = require('./_tokenStore');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try{
    const meta = await getConnection('meta').catch(()=>null);
    const tiktok = await getConnection('tiktok').catch(()=>null);
    res.status(200).json({
      meta: meta ? { connected:true, pageName: meta.pageName||'', igUsername: meta.igUsername||'' } : { connected:false },
      tiktok: tiktok ? { connected:true, displayName: tiktok.displayName||'' } : { connected:false }
    });
  }catch(err){
    res.status(200).json({
      meta: { connected:false }, tiktok: { connected:false },
      note: 'Could not reach Firestore — check FIREBASE_SERVICE_ACCOUNT, or this deployment may be using env-var-only configuration.'
    });
  }
};
