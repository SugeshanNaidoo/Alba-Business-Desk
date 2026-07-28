// Cancels the signed-in account's recurring billing agreement with PayFast
// — this is what actually stops future card charges, not just a status
// flag on our side. If the PayFast API call fails, the account is left as
// "active" and the failure is reported back rather than silently marking
// it cancelled while PayFast keeps charging the card.

const { setCors } = require('./_util');
const { verifyRequestToken } = require('./_verifyAuth');
const { getDb } = require('./_firebaseAdmin');
const { cancelSubscription } = require('./_payfast');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let decoded;
  try{
    decoded = await verifyRequestToken(req);
  }catch(err){
    return res.status(err.status||401).json({ error: err.message });
  }

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  if(!merchantId){
    return res.status(500).json({ error: 'Billing is not configured on this server.' });
  }

  try{
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(decoded.uid);
    const doc = await subRef.get();
    const data = doc.exists ? doc.data() : null;

    if(!data || !data.payfastToken || data.status !== 'active'){
      // Nothing active to cancel — treat as already-cancelled rather than an error.
      await subRef.set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true });
      return res.status(200).json({ ok: true, note: 'No active subscription was found to cancel.' });
    }

    const result = await cancelSubscription(data.payfastToken, { merchantId, passphrase });
    if(!result.ok){
      console.error('PayFast cancel failed:', result.status, result.body);
      return res.status(502).json({
        error: 'PayFast did not confirm the cancellation. Your subscription has NOT been changed — please try again, or cancel it directly from your PayFast account.',
        detail: result.body
      });
    }

    await subRef.set({ status: 'cancelled', cancelledAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not process the cancellation.' });
  }
};
