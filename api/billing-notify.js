// PayFast posts here after every payment event (initial charge, each
// monthly recurring charge, cancellations, failures). This is the ONLY
// place subscription status ever gets written — never trust a status the
// browser claims about itself.
//
// Set this exact URL as your notify_url / this endpoint's full address in
// PayFast's merchant settings: {APP_BASE_URL}/api/billing-notify

const { getDb } = require('./_firebaseAdmin');
const { validateItn, isRequestFromPayfast } = require('./_payfast');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const body = req.body || {};
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';

  // Acknowledge receipt quickly (PayFast retries if this hangs or errors),
  // but only ever trust the contents after validation below.
  try{
    const remoteIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const fromPayfast = await isRequestFromPayfast(remoteIp);
    if(!fromPayfast && process.env.PAYFAST_SANDBOX !== 'true'){
      console.error('ITN rejected — request did not come from a recognized PayFast host:', remoteIp);
      return res.status(400).send('Invalid source');
    }

    const { valid, reason } = await validateItn(body, passphrase);
    if(!valid){
      console.error('ITN validation failed:', reason);
      return res.status(400).send('Invalid notification');
    }

    const uid = body.m_payment_id;
    if(!uid){
      console.error('ITN missing m_payment_id — cannot associate with an account');
      return res.status(400).send('Missing account reference');
    }

    const status = (body.payment_status || '').toUpperCase();
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(uid);

    if(status === 'COMPLETE'){
      await subRef.set({
        status: 'active',
        payfastToken: body.token || null,
        lastPaymentAt: Date.now(),
        lastAmount: body.amount_gross || null,
        pfPaymentId: body.pf_payment_id || null,
        updatedAt: Date.now()
      }, { merge: true });
    } else if(status === 'FAILED'){
      await subRef.set({ status: 'payment_failed', updatedAt: Date.now() }, { merge: true });
    } else if(status === 'CANCELLED'){
      await subRef.set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true });
    } else {
      await subRef.set({ status: status.toLowerCase() || 'unknown', updatedAt: Date.now() }, { merge: true });
    }

    return res.status(200).send('OK');
  }catch(err){
    console.error('ITN processing error:', err);
    // Still 200 here would hide real failures from PayFast's retry logic —
    // let it retry rather than silently losing a payment update.
    return res.status(500).send('Error processing notification');
  }
};
