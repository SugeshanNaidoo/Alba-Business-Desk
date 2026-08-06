// Everything WhatsApp-related in one function, routed by ?action=, to stay
// within Vercel Hobby's serverless function limit:
//   ?action=connect        (POST) → save this customer's own WhatsApp credentials
//   ?action=status         (GET)  → is WhatsApp connected (for the UI)
//   ?action=disconnect     (POST) → remove the connection
//   ?action=webhook        (GET for Meta's verification handshake, POST for incoming messages)
//   ?action=send-message   (POST) → send a message to a contact
//   ?action=get-messages   (GET)  → message history for one contact's phone number
//
// Connecting here is a paste-your-credentials form, not an OAuth popup —
// the WhatsApp Business Platform doesn't have a simple consumer login flow
// the way Facebook does; a business generates a permanent access token in
// Meta Business Manager (System Users) and provides it directly. This
// matches how the platform actually expects a single business to connect
// its own number.
//
// Register ONE webhook URL in your Meta App's WhatsApp product settings:
//   {APP_BASE_URL}/api/whatsapp?action=webhook

const { setCors } = require('../lib/util');
const { getConnection, setConnection, deleteConnection } = require('../lib/tokenStore');
const { getDb } = require('../lib/firebaseAdmin');
const { verifySession } = require('../lib/session');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { isUserSubscribed } = require('../lib/subscriptionCheck');
const { sendTextMessage, verifyCredentials, verifyWebhookSignature } = require('../lib/whatsapp');

const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp's own 24-hour rule, not ours

function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,10); }

// Normalizes a phone number to a bare digit string for matching WhatsApp's
// "wa_id" format (no +, no spaces, no dashes).
function normalizePhone(phone){
  return (phone || '').replace(/[^\d]/g, '');
}

/* ---------- Connect ---------- */
async function handleConnect(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  if(!(await isUserSubscribed(decoded.uid))){
    return res.status(402).json({ error: 'An active subscription is needed to connect WhatsApp.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`wa-connect:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many attempts — please wait a minute and try again.' });
  }

  const { phoneNumberId, wabaId, accessToken } = req.body || {};
  if(!phoneNumberId || !wabaId || !accessToken){
    return res.status(400).json({ error: 'Phone Number ID, WhatsApp Business Account ID, and Access Token are all required.' });
  }

  try{
    const verified = await verifyCredentials({ accessToken, phoneNumberId });

    const db = getDb();
    // Clean up a stale reverse-lookup entry if this account is reconnecting
    // with a different phone number than before.
    const existing = await getConnection(decoded.uid, 'whatsapp');
    if(existing && existing.phoneNumberId && existing.phoneNumberId !== phoneNumberId){
      await db.collection('whatsapp_phone_lookup').doc(existing.phoneNumberId).delete().catch(()=>{});
    }

    await setConnection(decoded.uid, 'whatsapp', {
      phoneNumberId, wabaId, accessToken,
      displayPhoneNumber: verified.displayPhoneNumber,
      verifiedName: verified.verifiedName,
      connectedAt: Date.now()
    });
    // Lets the webhook figure out which customer an incoming message
    // belongs to, without needing a Firestore composite-index query.
    await db.collection('whatsapp_phone_lookup').doc(phoneNumberId).set({ uid: decoded.uid, updatedAt: Date.now() });

    await logEvent('whatsapp_connected', { uid: decoded.uid, detail: verified.displayPhoneNumber });
    return res.status(200).json({ ok: true, displayPhoneNumber: verified.displayPhoneNumber, verifiedName: verified.verifiedName });
  }catch(err){
    console.error('WhatsApp connect failed:', err.message);
    return res.status(400).json({ error: err.message || 'Could not verify these WhatsApp credentials.' });
  }
}

/* ---------- Status ---------- */
async function handleStatus(req, res){
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  try{
    const conn = await getConnection(decoded.uid, 'whatsapp');
    return res.status(200).json(conn ? {
      connected: true,
      displayPhoneNumber: conn.displayPhoneNumber || '',
      verifiedName: conn.verifiedName || ''
    } : { connected: false });
  }catch(err){
    return res.status(200).json({ connected: false, note: 'Could not reach Firestore.' });
  }
}

/* ---------- Disconnect ---------- */
async function handleDisconnect(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  try{
    const conn = await getConnection(decoded.uid, 'whatsapp');
    if(conn && conn.phoneNumberId){
      await getDb().collection('whatsapp_phone_lookup').doc(conn.phoneNumberId).delete().catch(()=>{});
    }
    await deleteConnection(decoded.uid, 'whatsapp');
    await logEvent('whatsapp_disconnected', { uid: decoded.uid });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'Could not disconnect WhatsApp.' });
  }
}

/* ---------- Webhook ---------- */
async function handleWebhookVerify(req, res){
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if(mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN){
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(challenge || '');
  }
  return res.status(403).send('Verification failed.');
}

async function handleWebhookMessage(req, res){
  // Read the raw bytes directly from the stream, before touching req.body
  // at all — Vercel's automatic JSON body parsing doesn't guarantee the
  // parsed-then-reserialized form matches Meta's original raw bytes
  // (key order, spacing), and HMAC signatures are computed over the exact
  // raw payload. Getting this wrong wouldn't error loudly — it would just
  // silently reject every real incoming message as "invalid signature."
  const rawBody = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  if(!verifyWebhookSignature(rawBody, signature, appSecret)){
    console.error('WhatsApp webhook signature invalid — rejecting.');
    return res.status(403).send('Invalid signature');
  }

  res.status(200).send('OK'); // acknowledge immediately, per Meta's requirements

  let payload;
  try{ payload = JSON.parse(rawBody); }
  catch(e){ console.error('Could not parse WhatsApp webhook payload:', e.message); return; }

  try{
    const entries = payload.entry || [];
    const db = getDb();
    for(const entry of entries){
      for(const change of (entry.changes || [])){
        const value = change.value || {};
        const phoneNumberId = value.metadata && value.metadata.phone_number_id;
        if(!phoneNumberId) continue;
        const lookupDoc = await db.collection('whatsapp_phone_lookup').doc(phoneNumberId).get();
        if(!lookupDoc.exists) continue; // message for a number we don't recognize
        const uid = lookupDoc.data().uid;

        for(const msg of (value.messages || [])){
          const body = msg.text ? msg.text.body : `[${msg.type} message]`;
          await db.collection('whatsapp_messages').add({
            uid, contactPhone: normalizePhone(msg.from),
            direction: 'inbound', body,
            waMessageId: msg.id, timestamp: Date.now(),
            status: 'received'
          });
        }
        // Delivery/read status updates for messages we sent
        for(const status of (value.statuses || [])){
          await db.collection('whatsapp_message_status').doc(status.id).set({
            uid, status: status.status, updatedAt: Date.now()
          }, { merge: true }).catch(()=>{});
        }
      }
    }
  }catch(err){
    console.error('Error processing WhatsApp webhook payload:', err.message);
  }
}

/* ---------- Send message ---------- */
async function handleSendMessage(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let decoded;
  try{ decoded = await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }
  if(!(await isUserSubscribed(decoded.uid))){
    return res.status(402).json({ error: 'An active subscription is needed to send WhatsApp messages.' });
  }
  const ip = clientIp(req);
  if(!(await checkRateLimit(`wa-send:${ip}`, { limit: 30, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many messages sent — please wait a minute and try again.' });
  }

  const { contactPhone, body } = req.body || {};
  if(!contactPhone || !body || !body.trim()){
    return res.status(400).json({ error: 'A contact phone number and a message are required.' });
  }
  const toPhone = normalizePhone(contactPhone);

  try{
    const conn = await getConnection(decoded.uid, 'whatsapp');
    if(!conn || !conn.accessToken){
      return res.status(400).json({ error: 'WhatsApp is not connected yet.' });
    }

    // WhatsApp only allows free-form messages within 24 hours of the
    // contact's last inbound message — this is Meta's own platform rule,
    // enforced on their end regardless, but checking it here first gives a
    // much clearer error than whatever Meta's API would return.
    const db = getDb();
    const lastInbound = await db.collection('whatsapp_messages')
      .where('uid', '==', decoded.uid).where('contactPhone', '==', toPhone)
      .where('direction', '==', 'inbound')
      .orderBy('timestamp', 'desc').limit(1).get();
    if(lastInbound.empty || (Date.now() - lastInbound.docs[0].data().timestamp) > FREE_FORM_WINDOW_MS){
      return res.status(409).json({
        error: "It's been more than 24 hours since this contact last messaged you, so WhatsApp only allows pre-approved template messages now — free-form replies aren't available until they message you again. Template messages aren't supported in this integration yet."
      });
    }

    const result = await sendTextMessage({ accessToken: conn.accessToken, phoneNumberId: conn.phoneNumberId, toPhone, body: body.trim() });
    await db.collection('whatsapp_messages').add({
      uid: decoded.uid, contactPhone: toPhone,
      direction: 'outbound', body: body.trim(),
      waMessageId: result.waMessageId, timestamp: Date.now(),
      status: 'sent'
    });
    await logEvent('whatsapp_message_sent', { uid: decoded.uid, ip });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error('WhatsApp send failed:', err.message);
    return res.status(502).json({ error: err.message || 'Could not send the message.' });
  }
}

/* ---------- Get messages ---------- */
async function handleGetMessages(req, res){
  if(req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let decoded;
  try{ decoded = await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const contactPhone = normalizePhone(req.query.contactPhone);
  if(!contactPhone) return res.status(400).json({ error: 'Missing contactPhone.' });

  try{
    const db = getDb();
    const snap = await db.collection('whatsapp_messages')
      .where('uid', '==', decoded.uid).where('contactPhone', '==', contactPhone)
      .orderBy('timestamp', 'asc').limit(200).get();
    const messages = snap.docs.map(d => { const m = d.data(); return { id: d.id, direction: m.direction, body: m.body, timestamp: m.timestamp, status: m.status }; });
    const isWithinWindow = messages.some(m => m.direction === 'inbound' && (Date.now() - m.timestamp) <= FREE_FORM_WINDOW_MS);
    return res.status(200).json({ messages, canSendFreeForm: isWithinWindow });
  }catch(err){
    console.error('WhatsApp get-messages failed:', err.message);
    return res.status(500).json({ error: 'Could not load message history.' });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;

  if(action === 'webhook'){
    if(req.method === 'GET') return handleWebhookVerify(req, res);
    if(req.method === 'POST') return handleWebhookMessage(req, res);
    return res.status(405).send('Method not allowed');
  }
  if(action === 'connect') return handleConnect(req, res);
  if(action === 'status') return handleStatus(req, res);
  if(action === 'disconnect') return handleDisconnect(req, res);
  if(action === 'send-message') return handleSendMessage(req, res);
  if(action === 'get-messages') return handleGetMessages(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
