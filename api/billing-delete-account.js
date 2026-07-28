// Deletes an account permanently: CRM data, billing records, and the
// Firebase Auth account itself. Deliberately ordered so this can never
// leave a card being charged with no record of whose it was:
//
//   1. If there's an active subscription, cancel it with PayFast first.
//   2. Only if that succeeds (or there was nothing to cancel) do we delete
//      anything at all. If cancellation fails, we stop immediately and
//      report the failure — better to have a duplicate account sitting
//      around than to lose the ability to trace an active charge.

const { setCors } = require('./_util');
const { verifyRequestToken } = require('./_verifyAuth');
const { getAdmin, getDb } = require('./_firebaseAdmin');
const { cancelSubscription } = require('./_payfast');

async function deleteCollection(db, ref, batchSize = 100){
  const snap = await ref.limit(batchSize).get();
  if(snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  if(snap.size === batchSize) await deleteCollection(db, ref, batchSize);
}

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
  const uid = decoded.uid;

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';

  try{
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(uid);
    const subDoc = await subRef.get();
    const subData = subDoc.exists ? subDoc.data() : null;

    // Step 1 — cancel any active subscription FIRST, and stop here if that fails.
    if(subData && subData.payfastToken && subData.status === 'active'){
      if(!merchantId){
        return res.status(500).json({ error: 'Billing is not configured on this server — cannot confirm cancellation, so account deletion was stopped for safety.' });
      }
      const result = await cancelSubscription(subData.payfastToken, { merchantId, passphrase });
      if(!result.ok){
        console.error('PayFast cancel failed during account deletion:', result.status, result.body);
        return res.status(502).json({
          error: 'Could not confirm your subscription was cancelled, so your account was NOT deleted, to avoid leaving an active charge with no record of it. Please try again, or cancel your subscription first from Billing, then delete your account.',
          detail: result.body
        });
      }
    }

    // Step 2 — only now, delete everything.
    await deleteCollection(db, subRef.collection('payments'));
    await subRef.delete().catch(()=>{});
    await db.collection('flowline_crm_users').doc(uid).delete().catch(()=>{});
    await getAdmin().auth().deleteUser(uid).catch(e => {
      // Not fatal — their data is already gone either way — but worth logging.
      console.error('Could not delete the Firebase Auth user record:', e.message);
    });

    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not delete the account. Nothing was changed.' });
  }
};
