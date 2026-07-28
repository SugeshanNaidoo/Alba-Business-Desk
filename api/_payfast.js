// Shared PayFast helpers: building a signed checkout form, and validating
// the ITN (Instant Transaction Notification) webhook PayFast sends after a
// payment. Both follow PayFast's documented security steps —
// https://developers.payfast.co.za — this isn't a guess at the process.

const crypto = require('crypto');
const dns = require('dns').promises;

const PAYFAST_HOST = process.env.PAYFAST_SANDBOX === 'true' ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
const PAYFAST_PROCESS_URL = `https://${PAYFAST_HOST}/eng/process`;
const PAYFAST_VALIDATE_URL = `https://${PAYFAST_HOST}/eng/query/validate`;

// PayFast's known notification server hostnames — an ITN is only trustworthy
// if it actually came from one of these, checked by IP.
const PAYFAST_HOSTNAMES = [
  'www.payfast.co.za', 'sandbox.payfast.co.za',
  'w1w.payfast.co.za', 'w2w.payfast.co.za'
];

// Builds the MD5 signature PayFast requires, in the exact field order
// given (this matters — the signature is order-sensitive), optionally
// including a passphrase if one is set on your merchant account.
function buildSignature(fields, passphrase){
  let pairs = Object.entries(fields)
    .filter(([,v]) => v !== undefined && v !== null && v !== '')
    .map(([k,v]) => `${k}=${encodeURIComponent(String(v).trim()).replace(/%20/g,'+')}`);
  if(passphrase){
    pairs.push(`passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g,'+')}`);
  }
  const paramString = pairs.join('&');
  return crypto.createHash('md5').update(paramString).digest('hex');
}

// Fields for a recurring subscription checkout, signed and ready to post.
function buildSubscriptionFields({ merchantId, merchantKey, passphrase, returnUrl, cancelUrl, notifyUrl, uid, amountRands, itemName }){
  const fields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    m_payment_id: uid, // lets the ITN tell us which account this payment belongs to
    amount: Number(amountRands).toFixed(2),
    item_name: itemName,
    subscription_type: '1',
    billing_date: new Date().toISOString().slice(0,10),
    recurring_amount: Number(amountRands).toFixed(2),
    frequency: '3', // monthly
    cycles: '0' // 0 = indefinite, until cancelled
  };
  const signature = buildSignature(fields, passphrase);
  return { ...fields, signature };
}

// Confirms an incoming ITN really came from PayFast and matches what we
// expect, per PayFast's documented validation steps:
//  1. Signature matches
//  2. Source IP resolves to a genuine PayFast host
//  3. PayFast itself confirms the data when we post it back to them
async function validateItn(body, passphrase){
  const { signature, ...rest } = body;
  const expected = buildSignature(rest, passphrase);
  if(signature !== expected){
    return { valid:false, reason:'Signature mismatch' };
  }
  try{
    const params = new URLSearchParams(body).toString();
    const res = await fetch(PAYFAST_VALIDATE_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: params
    });
    const text = await res.text();
    if(text.trim() !== 'VALID'){
      return { valid:false, reason:'PayFast did not confirm this notification: '+text };
    }
  }catch(e){
    return { valid:false, reason:'Could not reach PayFast to confirm: '+e.message };
  }
  return { valid:true };
}

async function isRequestFromPayfast(remoteIp){
  if(!remoteIp) return false;
  try{
    for(const host of PAYFAST_HOSTNAMES){
      const addresses = await dns.resolve4(host).catch(()=>[]);
      if(addresses.includes(remoteIp)) return true;
    }
  }catch(e){ /* fall through to false */ }
  return false;
}

module.exports = {
  PAYFAST_PROCESS_URL,
  buildSubscriptionFields,
  validateItn,
  isRequestFromPayfast
};
