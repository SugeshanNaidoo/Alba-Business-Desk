// The CRM calls this after sign-in to decide whether to show the app or a
// "please subscribe" screen. Requires a valid Firebase ID token so nobody
// can check (or worse, guess) someone else's subscription status.

const { setCors } = require('./_util');
const { verifyRequestToken } = require('./_verifyAuth');
const { getDb } = require('./_firebaseAdmin');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let decoded;
  try{
    decoded = await verifyRequestToken(req);
  }catch(err){
    return res.status(err.status||401).json({ error: err.message });
  }

  try{
    const db = getDb();
    const doc = await db.collection('subscriptions').doc(decoded.uid).get();
    if(!doc.exists){
      return res.status(200).json({ status: 'none' });
    }
    const data = doc.data();
    return res.status(200).json({
      status: data.status || 'none',
      lastPaymentAt: data.lastPaymentAt || null
    });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not check subscription status.' });
  }
};
