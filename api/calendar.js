// Lets the signed-in CRM user view, create, edit, and delete events on
// their connected Google Calendar, directly from within the CRM. Every
// action here requires a real signed-in session — there is no public,
// unauthenticated access to any of this, on purpose.
//
//   ?action=connect        (GET)  → start or complete the Google OAuth connection
//   ?action=status         (GET)  → is Google Calendar connected (for the UI)
//   ?action=list-events    (GET)  → upcoming events in a date range
//   ?action=create-event   (POST) → create a new event
//   ?action=update-event   (POST) → edit an existing event
//   ?action=delete-event   (POST) → delete an event
//
// Register this URL as the OAuth redirect URI in Google Cloud Console:
//   {APP_BASE_URL}/api/calendar?action=connect

const { setCors, parseCookies, setCookie } = require('../lib/util');
const { setConnection, getConnection } = require('../lib/tokenStore');
const { verifySession } = require('../lib/session');
const { checkRateLimit } = require('../lib/rateLimit');
const { logEvent, clientIp } = require('../lib/auditLog');
const { listEvents, createEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');
const crypto = require('crypto');

/* ---------- Connect (start + callback combined, like the other OAuth flows) ---------- */
async function handleConnectStart(req, res){
  try{ await verifySession(req); }
  catch(err){ return res.status(err.status||401).send('You need to be signed in to connect Google Calendar. Go back to the CRM, sign in with Google, and try again.'); }

  const ip = clientIp(req);
  if(!(await checkRateLimit(`gcal-connect:${ip}`, { limit: 10, windowSeconds: 60 }))){
    return res.status(429).send('Too many attempts — please wait a minute and try again.');
  }
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const baseUrl = process.env.APP_BASE_URL;
  if(!clientId || !baseUrl){
    return res.status(500).send('GOOGLE_CALENDAR_CLIENT_ID and APP_BASE_URL must be set on the server first.');
  }
  const redirectUri = `${baseUrl}/api/calendar?action=connect`;
  const scope = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/userinfo.email'
  ].join(' ');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'gcal_oauth_state', state, { maxAgeSeconds: 600 });
  // access_type=offline gets a refresh token; prompt=consent forces Google to
  // issue one even on a re-connect (Google only issues it the very first
  // time otherwise, which breaks reconnecting after a disconnect).
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}

async function handleConnectCallback(req, res){
  const { code, error, state } = req.query;
  const crmUrl = process.env.CRM_URL || '/';

  if(error){
    res.writeHead(302, { Location: `${crmUrl}?social_connect=gcal_denied` });
    return res.end();
  }
  const cookies = parseCookies(req);
  if(!state || !cookies.gcal_oauth_state || state !== cookies.gcal_oauth_state){
    console.error('Google Calendar OAuth state mismatch — possible CSRF attempt or expired flow.');
    res.writeHead(302, { Location: `${crmUrl}?social_connect=gcal_error` });
    return res.end();
  }

  try{
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const baseUrl = process.env.APP_BASE_URL;
    const redirectUri = `${baseUrl}/api/calendar?action=connect`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    const tokenData = await tokenRes.json();
    if(!tokenData.refresh_token){
      throw new Error(tokenData.error_description || 'Google did not return a refresh token. If you\'ve connected this before, remove Alba Business Desk from your Google Account\'s connected apps and try again — Google only issues a refresh token on the first, fully-fresh consent.');
    }

    let calendarEmail = '';
    try{
      const profRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const prof = await profRes.json();
      calendarEmail = prof.email || '';
    }catch(e){ /* cosmetic only */ }

    await setConnection('google_calendar', {
      refreshToken: tokenData.refresh_token,
      calendarId: 'primary',
      calendarEmail,
      connectedAt: Date.now()
    });
    logEvent('google_calendar_connected', { detail: calendarEmail });

    res.writeHead(302, { Location: `${crmUrl}?social_connect=gcal_success` });
    res.end();
  }catch(err){
    console.error(err);
    res.writeHead(302, { Location: `${crmUrl}?social_connect=gcal_error` });
    res.end();
  }
}

/* ---------- Status ---------- */
async function handleStatus(req, res){
  try{
    const conn = await getConnection('google_calendar');
    return res.status(200).json(conn ? { connected: true, calendarEmail: conn.calendarEmail || '' } : { connected: false });
  }catch(err){
    return res.status(200).json({ connected: false, note: 'Could not reach Firestore.' });
  }
}

/* ---------- List events ---------- */
async function handleListEvents(req, res){
  if(req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try{ await verifySession(req); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const timeMin = req.query.timeMin || new Date().toISOString();
  const timeMaxDate = new Date(timeMin);
  timeMaxDate.setDate(timeMaxDate.getDate() + (Number(req.query.days) || 30));

  try{
    const events = await listEvents(timeMin, timeMaxDate.toISOString(), 100);
    return res.status(200).json({ events });
  }catch(err){
    console.error('listEvents error:', err.message);
    if(err.status === 400) return res.status(400).json({ error: err.message });
    return res.status(502).json({ error: 'Could not load calendar events right now.' });
  }
}

/* ---------- Create event ---------- */
async function handleCreateEvent(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try{ await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const ip = clientIp(req);
  if(!(await checkRateLimit(`gcal-create:${ip}`, { limit: 30, windowSeconds: 60 }))){
    return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
  }
  const { summary, description, startTime, endTime, attendeeEmails, needsMeet } = req.body || {};
  if(!summary || !startTime || !endTime){
    return res.status(400).json({ error: 'A title, start time, and end time are required.' });
  }
  const start = new Date(startTime), end = new Date(endTime);
  if(isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start){
    return res.status(400).json({ error: 'Please provide a valid start and end time, with the end after the start.' });
  }
  try{
    const result = await createEvent({
      summary, description: description || '',
      startISO: start.toISOString(), endISO: end.toISOString(),
      needsMeet: !!needsMeet,
      attendeeEmail: Array.isArray(attendeeEmails) && attendeeEmails[0] ? attendeeEmails[0] : undefined
    });
    logEvent('calendar_event_created', { detail: summary, ip });
    return res.status(200).json({ ok: true, eventId: result.eventId, meetLink: result.meetLink, htmlLink: result.htmlLink });
  }catch(err){
    console.error('createEvent error:', err.message);
    return res.status(502).json({ error: 'Could not create the calendar event.' });
  }
}

/* ---------- Update event ---------- */
async function handleUpdateEvent(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try{ await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const { eventId, summary, description, startTime, endTime, attendeeEmails, needsMeet } = req.body || {};
  if(!eventId) return res.status(400).json({ error: 'Missing eventId.' });

  let startISO, endISO;
  if(startTime){
    const start = new Date(startTime);
    if(isNaN(start.getTime())) return res.status(400).json({ error: 'Invalid start time.' });
    startISO = start.toISOString();
  }
  if(endTime){
    const end = new Date(endTime);
    if(isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid end time.' });
    endISO = end.toISOString();
  }

  try{
    const result = await updateEvent(eventId, { startISO, endISO, summary, description, attendeeEmails, needsMeet: !!needsMeet });
    logEvent('calendar_event_updated', { detail: eventId });
    return res.status(200).json({ ok: true, meetLink: result.meetLink || null });
  }catch(err){
    console.error('updateEvent error:', err.message);
    return res.status(502).json({ error: 'Could not update the calendar event.' });
  }
}

/* ---------- Delete event ---------- */
async function handleDeleteEvent(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try{ await verifySession(req, { requireCsrf: true }); }
  catch(err){ return res.status(err.status||401).json({ error: err.message }); }

  const { eventId } = req.body || {};
  if(!eventId) return res.status(400).json({ error: 'Missing eventId.' });

  try{
    await deleteEvent(eventId);
    logEvent('calendar_event_deleted', { detail: eventId });
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error('deleteEvent error:', err.message);
    return res.status(502).json({ error: 'Could not delete the calendar event.' });
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;

  if(action === 'connect'){
    if(req.query.code || req.query.error) return handleConnectCallback(req, res);
    return handleConnectStart(req, res);
  }
  if(action === 'status') return handleStatus(req, res);
  if(action === 'list-events') return handleListEvents(req, res);
  if(action === 'create-event') return handleCreateEvent(req, res);
  if(action === 'update-event') return handleUpdateEvent(req, res);
  if(action === 'delete-event') return handleDeleteEvent(req, res);
  return res.status(400).json({ error: 'Unknown or missing ?action=' });
};
