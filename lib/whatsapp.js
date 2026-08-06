// Talks to Meta's WhatsApp Business Platform (Cloud API) on behalf of a
// connected number. Each signed-in customer connects their own WhatsApp
// Business phone number — this is never a shared workspace-wide number.

const crypto = require('crypto');

const GRAPH_VERSION = 'v22.0';

// Sends a free-form text message. Only valid within 24 hours of the
// contact's last inbound message — WhatsApp itself enforces this, not
// just a courtesy limit here; outside that window Meta rejects the send
// unless it's a pre-approved template message (not built here — see the
// README note on this).
async function sendTextMessage({ accessToken, phoneNumberId, toPhone, body }){
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body }
    })
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return { waMessageId: (data.messages && data.messages[0] && data.messages[0].id) || null };
}

// Verifies a connected number's credentials are actually valid, by asking
// the Graph API for basic info about the phone number — used right after
// connecting, so a typo'd token or ID is caught immediately instead of
// silently failing on the first real send.
async function verifyCredentials({ accessToken, phoneNumberId }){
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message || 'Could not verify these WhatsApp credentials.');
  return { displayPhoneNumber: data.display_phone_number || '', verifiedName: data.verified_name || '' };
}

// Meta signs every webhook POST body with your App Secret
// (X-Hub-Signature-256: sha256=<hmac>). This confirms a webhook call
// genuinely came from Meta — the same security role PayFast's ITN
// signature plays for payments.
function verifyWebhookSignature(rawBody, signatureHeader, appSecret){
  if(!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  // Constant-time comparison — a plain === here would leak timing
  // information an attacker could use to guess the correct signature
  // byte-by-byte.
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(received, 'hex');
  if(expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = { sendTextMessage, verifyCredentials, verifyWebhookSignature };
