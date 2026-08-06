// Talks to Google's Calendar API on behalf of the connected account. This is
// a SEPARATE connection from Firebase's "Sign in with Google" — that one
// only proves identity and doesn't grant calendar access. Every function
// here takes a uid: each signed-in customer connects and manages their own
// calendar, not a single shared one for the whole workspace.

const { getConnection } = require('./tokenStore');

const CAL_API = 'https://www.googleapis.com/calendar/v3';

async function getAccessToken(uid){
  const conn = await getConnection(uid, 'google_calendar');
  if(!conn || !conn.refreshToken){
    const err = new Error('Google Calendar is not connected yet.');
    err.status = 400;
    throw err;
  }
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: conn.refreshToken, grant_type: 'refresh_token'
    })
  });
  const data = await tokenRes.json();
  if(!data.access_token){
    throw new Error(data.error_description || 'Could not refresh Google Calendar access — it may need reconnecting.');
  }
  // Unlike TikTok, Google does not rotate the refresh token on each use,
  // so there's nothing to write back here.
  return { accessToken: data.access_token, calendarId: conn.calendarId || 'primary' };
}

// Returns an array of {start, end} busy ranges (ISO strings) for the given window.
async function getFreeBusy(uid, timeMinISO, timeMaxISO){
  const { accessToken, calendarId } = await getAccessToken(uid);
  const res = await fetch(`${CAL_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] })
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  const cal = data.calendars && data.calendars[calendarId];
  return (cal && cal.busy) || [];
}

// Returns upcoming events between the given window, ordered by start time —
// what the CRM's Calendar tab lists.
async function listEvents(uid, timeMinISO, timeMaxISO, maxResults){
  const { accessToken, calendarId } = await getAccessToken(uid);
  const params = new URLSearchParams({
    timeMin: timeMinISO, timeMax: timeMaxISO,
    singleEvents: 'true', orderBy: 'startTime',
    maxResults: String(maxResults || 50)
  });
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return (data.items || []).map(ev => {
    const meetEntry = ev.conferenceData && ev.conferenceData.entryPoints
      ? ev.conferenceData.entryPoints.find(e => e.entryPointType === 'video')
      : null;
    return {
      id: ev.id,
      summary: ev.summary || '(No title)',
      description: ev.description || '',
      start: (ev.start && (ev.start.dateTime || ev.start.date)) || null,
      end: (ev.end && (ev.end.dateTime || ev.end.date)) || null,
      allDay: !!(ev.start && ev.start.date && !ev.start.dateTime),
      attendees: (ev.attendees || []).map(a => a.email).filter(Boolean),
      meetLink: meetEntry ? meetEntry.uri : null,
      htmlLink: ev.htmlLink || null,
      status: ev.status
    };
  });
}

// Creates a calendar event. If needsMeet is true, requests a Google Meet
// conference link on the event (conferenceDataVersion=1 is required for
// Google to actually generate one).
async function createEvent(uid, { summary, description, startISO, endISO, attendeeEmail, attendeeName, needsMeet }){
  const { accessToken, calendarId } = await getAccessToken(uid);
  const body = {
    summary,
    description: description || '',
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    attendees: attendeeEmail ? [{ email: attendeeEmail, displayName: attendeeName || undefined }] : []
  };
  let url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  if(needsMeet){
    body.conferenceData = {
      createRequest: { requestId: cryptoRandomId(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
    };
    url += '?conferenceDataVersion=1';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  const meetEntry = data.conferenceData && data.conferenceData.entryPoints
    ? data.conferenceData.entryPoints.find(e => e.entryPointType === 'video')
    : null;
  return { eventId: data.id, meetLink: meetEntry ? meetEntry.uri : null, htmlLink: data.htmlLink };
}

async function updateEvent(uid, eventId, { startISO, endISO, summary, description, attendeeEmails, needsMeet }){
  const { accessToken, calendarId } = await getAccessToken(uid);
  const body = {};
  if(startISO) body.start = { dateTime: startISO };
  if(endISO) body.end = { dateTime: endISO };
  if(summary) body.summary = summary;
  if(description !== undefined) body.description = description;
  if(attendeeEmails) body.attendees = attendeeEmails.map(email => ({ email }));
  let url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  if(needsMeet){
    body.conferenceData = {
      createRequest: { requestId: cryptoRandomId(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
    };
    url += '?conferenceDataVersion=1';
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  const meetEntry = data.conferenceData && data.conferenceData.entryPoints
    ? data.conferenceData.entryPoints.find(e => e.entryPointType === 'video')
    : null;
  return { ...data, meetLink: meetEntry ? meetEntry.uri : null };
}

async function deleteEvent(uid, eventId){
  const { accessToken, calendarId } = await getAccessToken(uid);
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  // Google returns 204 on success, 410 if it was already deleted — both are fine.
  if(res.status !== 204 && res.status !== 200 && res.status !== 410){
    const data = await res.json().catch(()=>({}));
    throw new Error((data.error && data.error.message) || 'Could not delete the calendar event.');
  }
}

function cryptoRandomId(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

module.exports = { getAccessToken, getFreeBusy, listEvents, createEvent, updateEvent, deleteEvent };
