// Records security-relevant events — sign-ins tied to billing actions,
// subscription changes, account deletions, failed auth, OAuth connections —
// so there's a trail to look back on. Never blocks the actual request if
// logging itself fails; an audit log write failing shouldn't take down a
// payment.

const { getDb } = require('./firebaseAdmin');

async function logEvent(event, { uid = null, detail = null, ip = null } = {}){
  try{
    const db = getDb();
    await db.collection('audit_logs').add({
      event, uid, detail, ip,
      timestamp: Date.now()
    });
  }catch(e){
    console.error('Audit log write failed (non-fatal):', e.message);
  }
}

function clientIp(req){
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || null;
}

module.exports = { logEvent, clientIp };
