// Returns the signed-in account's payment history, most recent first —
// what the CRM's Billing tab lists, and where "download statement" pulls
// its data from.

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
    const snap = await db.collection('subscriptions').doc(decoded.uid)
      .collection('payments').orderBy('date', 'desc').limit(100).get();
    const payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ payments });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not load payment history.' });
  }
};
