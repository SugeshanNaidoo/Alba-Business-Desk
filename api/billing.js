// Every billing operation in one function, routed by ?action=, to stay
// within Vercel Hobby's serverless function limit:
//   ?action=checkout        (GET,  ?idToken=...)      → redirects into PayFast checkout
//   ?action=status          (GET,  Authorization header) → subscription status
//   ?action=history         (GET,  Authorization header) → payment history list
//   ?action=cancel          (POST, Authorization header) → cancels the subscription
//   ?action=delete-account  (POST, Authorization header) → cancels + deletes everything
//   ?action=notify                                        → PayFast's ITN webhook
//
// Set PayFast's notify_url to: {APP_BASE_URL}/api/billing?action=notify

const { setCors, normalizeBaseUrl } = require('../lib/util');
const { verifySession } = require('../lib/session');
const { getAdmin, getDb } = require('../lib/firebaseAdmin');
const { buildSubscriptionFields, PAYFAST_PROCESS_URL, validateItn, isRequestFromPayfast, cancelSubscription } = require('../lib/payfast');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');

const MONTHLY_AMOUNT = 699; // R699/month flat rate

async function handleCheckout(req, res){
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const ip = clientIp(req);
  if(!(await checkRateLimit(`checkout:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).send('Too many attempts — please wait a minute and try again.');
  }
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).send('You need to be signed in to subscribe. Go back to the CRM, sign in with Google, and try again.'); }
  await logEvent('checkout_started', { uid: decoded.uid, ip });

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const appBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL);
  const crmUrl = process.env.CRM_URL || '/';
  if(!merchantId || !merchantKey || !appBaseUrl){
    return res.status(500).send('Billing is not configured on this server yet. Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, and APP_BASE_URL.');
  }

  const fields = buildSubscriptionFields({
    merchantId, merchantKey, passphrase,
    returnUrl: `${crmUrl}?billing=success`,
    cancelUrl: `${crmUrl}?billing=cancelled`,
    notifyUrl: `${appBaseUrl}/api/billing?action=notify`,
    uid: decoded.uid,
    amountRands: MONTHLY_AMOUNT,
    itemName: 'Alba Business Desk — monthly subscription'
  });

  const inputs = Object.entries(fields)
    .map(([k,v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g,'&quot;')}">`)
    .join('\n');

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`<!DOCTYPE html>
<html><head><title>Redirecting to PayFast…</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#444;">
  <div>
    <p>Taking you to PayFast to complete your subscription…</p>
    <form id="pfForm" action="${PAYFAST_PROCESS_URL}" method="post">
      ${inputs}
    </form>
  </div>
  <script>document.getElementById('pfForm').submit();</script>
</body></html>`);
}

async function handleStatus(req, res){
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  try{
    const doc = await getDb().collection('subscriptions').doc(decoded.uid).get();
    if(!doc.exists) return res.status(200).json({ status: 'none' });
    const data = doc.data();
    return res.status(200).json({ status: data.status || 'none', lastPaymentAt: data.lastPaymentAt || null });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not check subscription status.' });
  }
}

async function handleHistory(req, res){
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  try{
    const snap = await getDb().collection('subscriptions').doc(decoded.uid)
      .collection('payments').orderBy('date', 'desc').limit(100).get();
    return res.status(200).json({ payments: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not load payment history.' });
  }
}

async function handleCancel(req, res){
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = clientIp(req);
  if(!(await checkRateLimit(`cancel:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many attempts — please wait a minute and try again.' });
  }
  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  if(!merchantId) return res.status(500).json({ error: 'Billing is not configured on this server.' });

  try{
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(decoded.uid);
    const doc = await subRef.get();
    const data = doc.exists ? doc.data() : null;

    if(!data || !data.payfastToken || data.status !== 'active'){
      await subRef.set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true });
      await logEvent('subscription_cancelled', { uid: decoded.uid, ip, detail: 'no active subscription found' });
      return res.status(200).json({ ok: true, note: 'No active subscription was found to cancel.' });
    }

    const result = await cancelSubscription(data.payfastToken, { merchantId, passphrase });
    if(!result.ok){
      console.error('PayFast cancel failed:', result.status, result.body);
      await logEvent('subscription_cancel_failed', { uid: decoded.uid, ip, detail: JSON.stringify(result.body).slice(0,500) });
      return res.status(502).json({
        error: 'PayFast did not confirm the cancellation. Your subscription has NOT been changed — please try again, or cancel it directly from your PayFast account.',
        detail: result.body
      });
    }
    await subRef.set({ status: 'cancelled', cancelledAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    await logEvent('subscription_cancelled', { uid: decoded.uid, ip });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not process the cancellation.' });
  }
}

async function deleteCollection(db, ref, batchSize = 100){
  const snap = await ref.limit(batchSize).get();
  if(snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  if(snap.size === batchSize) await deleteCollection(db, ref, batchSize);
}

async function handleDeleteAccount(req, res){
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = clientIp(req);
  if(!(await checkRateLimit(`delete:${ip}`, { limit: 5, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many attempts — please wait a minute and try again.' });
  }
  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  const uid = decoded.uid;

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';

  try{
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(uid);
    const subDoc = await subRef.get();
    const subData = subDoc.exists ? subDoc.data() : null;

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

    await logEvent('account_deleted', { uid, ip });
    await deleteCollection(db, subRef.collection('payments'));
    await subRef.delete().catch(()=>{});
    await db.collection('flowline_crm_users').doc(uid).delete().catch(()=>{});
    // Connections are per-customer now — clean up this account's own, not
    // a shared workspace-wide set that belongs to anyone else.
    for(const platform of ['meta', 'instagram', 'tiktok', 'google_calendar']){
      await db.collection('social_connections').doc(`${uid}_${platform}`).delete().catch(()=>{});
    }
    await getAdmin().auth().deleteUser(uid).catch(e => console.error('Could not delete the Firebase Auth user record:', e.message));

    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not delete the account. Nothing was changed.' });
  }
}

async function handleNotify(req, res){
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const body = req.body || {};
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const remoteIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  // Logged unconditionally, before any validation — if PayFast reports a
  // delivery failure (e.g. their vague "Invalid Header" message) with no
  // further detail, this is what tells us what they actually sent rather
  // than guessing blind a second time.
  console.log('ITN received:', JSON.stringify(body));
  if(!(await checkRateLimit(`notify:${remoteIp}`, { limit: 30, windowSeconds: 60 }))){
    console.error('ITN rate-limited from', remoteIp);
    return res.status(429).send('Too many requests');
  }
  try{
    const fromPayfast = await isRequestFromPayfast(remoteIp);
    if(!fromPayfast && process.env.PAYFAST_SANDBOX !== 'true'){
      console.error('ITN rejected — request did not come from a recognized PayFast host:', remoteIp);
      await logEvent('itn_rejected_source', { ip: remoteIp, detail: 'not a recognized PayFast host' });
      return res.status(400).send('Invalid source');
    }
    const { valid, reason } = await validateItn(body, passphrase);
    if(!valid){
      console.error('ITN validation failed:', reason);
      await logEvent('itn_rejected_signature', { ip: remoteIp, detail: reason });
      return res.status(400).send('Invalid notification');
    }
    const uid = body.m_payment_id;
    if(!uid){
      // Not every notification PayFast sends is tied to one specific
      // payment (a subscription lifecycle event, for instance, may not
      // carry it) — acknowledge receipt rather than returning an error for
      // something we simply have nothing to act on.
      console.log('ITN has no m_payment_id — acknowledging without action:', JSON.stringify(body));
      return res.status(200).send('OK');
    }

    const status = (body.payment_status || '').toUpperCase();
    const db = getDb();
    const subRef = db.collection('subscriptions').doc(uid);

    if(status === 'COMPLETE'){
      await subRef.set({
        status: 'active', payfastToken: body.token || null,
        lastPaymentAt: Date.now(), lastAmount: body.amount_gross || null,
        pfPaymentId: body.pf_payment_id || null, updatedAt: Date.now()
      }, { merge: true });
      const paymentId = body.pf_payment_id || `${uid}-${Date.now()}`;
      await subRef.collection('payments').doc(paymentId).set({
        amount: Number(body.amount_gross) || 0, date: Date.now(),
        pfPaymentId: body.pf_payment_id || null, status: 'complete'
      }, { merge: true });
      await logEvent('payment_completed', { uid, ip: remoteIp, detail: `R${body.amount_gross}` });
    } else if(status === 'FAILED'){
      await subRef.set({ status: 'payment_failed', updatedAt: Date.now() }, { merge: true });
      await logEvent('payment_failed', { uid, ip: remoteIp });
    } else if(status === 'CANCELLED'){
      await subRef.set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true });
    } else {
      await subRef.set({ status: status.toLowerCase() || 'unknown', updatedAt: Date.now() }, { merge: true });
    }
    return res.status(200).send('OK');
  }catch(err){
    console.error('ITN processing error:', err);
    return res.status(500).send('Error processing notification');
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;
  if(action === 'checkout') return handleCheckout(req, res);
  if(action === 'status') return handleStatus(req, res);
  if(action === 'history') return handleHistory(req, res);
  if(action === 'cancel') return handleCancel(req, res);
  if(action === 'delete-account') return handleDeleteAccount(req, res);
  if(action === 'notify') return handleNotify(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
