// Starts a subscription checkout for the signed-in account. The browser is
// sent here as a full-page redirect (so it needs the ID token as a query
// param, not a header — see _verifyAuth.js). Responds with a small HTML
// page that auto-submits a signed form to PayFast's hosted payment page,
// which is PayFast's standard integration pattern — card details are
// entered on PayFast's page, never on ours.

const { setCors } = require('./_util');
const { verifyRequestToken } = require('./_verifyAuth');
const { buildSubscriptionFields, PAYFAST_PROCESS_URL } = require('./_payfast');

const MONTHLY_AMOUNT = 1000; // R1000/month flat rate

module.exports = async (req, res) => {
  setCors(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let decoded;
  try{
    decoded = await verifyRequestToken(req);
  }catch(err){
    return res.status(err.status||401).send('You need to be signed in to subscribe. Go back to the CRM, sign in with Google, and try again.');
  }

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const appBaseUrl = process.env.APP_BASE_URL;
  const crmUrl = process.env.CRM_URL || '/';
  if(!merchantId || !merchantKey || !appBaseUrl){
    return res.status(500).send('Billing is not configured on this server yet. Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, and APP_BASE_URL.');
  }

  const fields = buildSubscriptionFields({
    merchantId, merchantKey, passphrase,
    returnUrl: `${crmUrl}?billing=success`,
    cancelUrl: `${crmUrl}?billing=cancelled`,
    notifyUrl: `${appBaseUrl}/api/billing-notify`,
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
};
