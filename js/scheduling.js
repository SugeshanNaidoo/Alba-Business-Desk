// Calendar tab: connect Google Calendar, then view, create, edit, and
// delete events directly from within the CRM. Nothing here is public —
// every action requires being signed in, same as billing.

function renderScheduling(){
  if(cloudUser){
    document.getElementById('gcalSignedOutNote').style.display = 'none';
    document.getElementById('gcalConnectedView').style.display = 'block';
    refreshGcalStatus();
  } else {
    document.getElementById('gcalSignedOutNote').style.display = 'block';
    document.getElementById('gcalConnectedView').style.display = 'none';
    document.getElementById('gcalEventsPanel').style.display = 'none';
  }
}

async function refreshGcalStatus(){
  const textEl = document.getElementById('gcalStatusText');
  const btnLabel = document.getElementById('connectGoogleCalendarBtnLabel');
  const eventsPanel = document.getElementById('gcalEventsPanel');
  const hint = document.getElementById('gcalHint');
  textEl.textContent = 'Checking…';
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=status`, { credentials:'include' });
    const data = await res.json();
    if(data.connected){
      textEl.textContent = `Connected${data.calendarEmail ? ' — '+data.calendarEmail : ''}`;
      btnLabel.textContent = 'Reconnect Google Calendar';
      hint.textContent = 'Connected. Events below are live from this calendar.';
      eventsPanel.style.display = 'block';
      loadCalendarEvents();
    } else {
      textEl.textContent = 'Not connected';
      btnLabel.textContent = 'Connect Google Calendar';
      hint.textContent = 'Connect your calendar to see, create, and manage events right here.';
      eventsPanel.style.display = 'none';
    }
  }catch(err){
    textEl.textContent = 'Could not check status';
  }
}
document.getElementById('connectGoogleCalendarBtn').addEventListener('click', ()=>{
  window.location.href = `${BACKEND_BASE}/api/calendar?action=connect`;
});

/* ---------- Events list ---------- */
let calendarEventsCache = [];
async function loadCalendarEvents(){
  const list = document.getElementById('calendarEventsList');
  const emptyEl = document.getElementById('calendarEventsEmpty');
  list.innerHTML = `<p class="topbar-sub" style="padding:6px 0;">Loading…</p>`;
  emptyEl.style.display = 'none';
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=list-events&days=30`, { credentials:'include' });
    const data = await res.json();
    if(!res.ok){ list.innerHTML = `<p class="topbar-sub">${escapeHtml(data.error||'Could not load events.')}</p>`; return; }
    calendarEventsCache = data.events || [];
    renderCalendarEventsList();
  }catch(err){
    list.innerHTML = `<p class="topbar-sub">Could not reach the calendar backend.</p>`;
  }
}
document.getElementById('refreshCalendarEventsBtn').addEventListener('click', loadCalendarEvents);

function renderCalendarEventsList(){
  const list = document.getElementById('calendarEventsList');
  const emptyEl = document.getElementById('calendarEventsEmpty');
  emptyEl.style.display = calendarEventsCache.length ? 'none' : 'block';
  list.innerHTML = calendarEventsCache.map(ev=>{
    const start = ev.start ? new Date(ev.start) : null;
    const end = ev.end ? new Date(ev.end) : null;
    const whenLabel = start
      ? (ev.allDay
          ? start.toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'}) + ' · All day'
          : `${start.toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short'})} · ${start.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}${end?' – '+end.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}):''}`)
      : '—';
    return `<div class="info-row" data-cal-event="${ev.id}" style="cursor:pointer;align-items:flex-start;">
      <span>
        <strong style="color:var(--ink);">${escapeHtml(ev.summary)}</strong>
        <div class="topbar-sub" style="font-size:12px;">${whenLabel}</div>
        ${ev.attendees && ev.attendees.length ? `<div class="topbar-sub" style="font-size:11.5px;">${escapeHtml(ev.attendees.join(', '))}</div>` : ''}
      </span>
      <span>${ev.meetLink ? `<a href="${escapeHtml(ev.meetLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:12px;">Join link</a>` : ''}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-cal-event]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const ev = calendarEventsCache.find(e=>e.id===row.dataset.calEvent);
      if(ev) openCalendarEventModal(ev);
    });
  });
}

/* ---------- Create / edit modal ---------- */
let editingCalendarEventId = null;
function toLocalInputValue(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openCalendarEventModal(ev){
  editingCalendarEventId = ev ? ev.id : null;
  document.getElementById('calendarEventModalTitle').textContent = ev ? 'Edit event' : 'New event';
  document.getElementById('ceSummary').value = ev ? ev.summary : '';
  document.getElementById('ceDescription').value = ev ? ev.description : '';
  document.getElementById('ceAttendee').value = ev && ev.attendees && ev.attendees[0] ? ev.attendees[0] : '';
  document.getElementById('ceMeet').checked = !!(ev && ev.meetLink);
  const meetWrap = document.getElementById('ceMeetLinkWrap');
  if(ev && ev.meetLink){ meetWrap.style.display = 'block'; document.getElementById('ceMeetLink').value = ev.meetLink; }
  else { meetWrap.style.display = 'none'; document.getElementById('ceMeetLink').value = ''; }

  if(ev && ev.start){
    document.getElementById('ceStart').value = toLocalInputValue(ev.start);
    document.getElementById('ceEnd').value = toLocalInputValue(ev.end);
  } else {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes()/15)*15, 0, 0);
    const later = new Date(now.getTime() + 30*60000);
    document.getElementById('ceStart').value = toLocalInputValue(now.toISOString());
    document.getElementById('ceEnd').value = toLocalInputValue(later.toISOString());
  }
  document.getElementById('deleteCalendarEventBtn').style.display = ev ? 'inline-flex' : 'none';
  document.getElementById('calendarEventModalOverlay').classList.add('active');
}
document.getElementById('addCalendarEventBtn').addEventListener('click', ()=>openCalendarEventModal(null));

document.getElementById('saveCalendarEventBtn').addEventListener('click', async ()=>{
  const summary = document.getElementById('ceSummary').value.trim();
  const startVal = document.getElementById('ceStart').value;
  const endVal = document.getElementById('ceEnd').value;
  if(!summary || !startVal || !endVal){ alert('Please fill in a title, start time, and end time.'); return; }
  const start = new Date(startVal), end = new Date(endVal);
  if(end <= start){ alert('The end time needs to be after the start time.'); return; }

  const attendeeEmail = document.getElementById('ceAttendee').value.trim();
  const payload = {
    summary,
    description: document.getElementById('ceDescription').value.trim(),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    attendeeEmails: attendeeEmail ? [attendeeEmail] : [],
    needsMeet: document.getElementById('ceMeet').checked
  };

  const btn = document.getElementById('saveCalendarEventBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const action = editingCalendarEventId ? 'update-event' : 'create-event';
    if(editingCalendarEventId) payload.eventId = editingCalendarEventId;
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=${action}`, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(!res.ok){ alert(data.error || 'Could not save this event.'); btn.disabled=false; btn.textContent='Save event'; return; }
    logActivity(editingCalendarEventId ? `Updated calendar event "${summary}"` : `Created calendar event "${summary}"`);
    closeModals();
    loadCalendarEvents();
  }catch(err){
    alert('Could not reach the calendar backend.');
  }
  btn.disabled = false; btn.textContent = 'Save event';
});

document.getElementById('deleteCalendarEventBtn').addEventListener('click', async ()=>{
  if(!editingCalendarEventId) return;
  if(!confirm('Delete this event from your Google Calendar? This cannot be undone.')) return;
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=delete-event`, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ eventId: editingCalendarEventId })
    });
    const data = await res.json();
    if(!res.ok){ alert(data.error || 'Could not delete this event.'); return; }
    closeModals();
    loadCalendarEvents();
  }catch(err){
    alert('Could not reach the calendar backend.');
  }
});
