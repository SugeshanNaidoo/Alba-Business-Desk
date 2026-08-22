// Calendar tab: connect Google Calendar, then browse a full month-grid
// calendar with events populated from Google, and create/edit/delete
// events directly from within the CRM. Nothing here is public — every
// action requires being signed in, same as billing.

let gcalConnected = false;
let calendarViewDate = new Date(); // which month is currently displayed
let calendarEventsCache = [];

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
      btnLabel.textContent = 'Disconnect Google Calendar';
      gcalConnected = true;
      if(typeof INTEGRATION_STATE !== 'undefined'){
        INTEGRATION_STATE.calendar = true;
        if(typeof renderOnboarding === 'function') renderOnboarding();
      }
      hint.textContent = 'Connected. Click any day to see, add, or edit its events.';
      eventsPanel.style.display = 'block';
      loadCalendarEvents();
    } else {
      textEl.textContent = 'Not connected';
      btnLabel.textContent = 'Connect Google Calendar';
      gcalConnected = false;
      if(typeof INTEGRATION_STATE !== 'undefined') INTEGRATION_STATE.calendar = false;
      hint.textContent = 'Connect your calendar to see, create, and manage events right here.';
      eventsPanel.style.display = 'none';
    }
  }catch(err){
    textEl.textContent = 'Could not check status';
  }
}
/* One button, two states — connects when disconnected, disconnects when
   connected, matching how the social platform buttons behave. */
document.getElementById('connectGoogleCalendarBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(typeof roleAtLeast === 'function' && !roleAtLeast('admin')){
    await showAlert('Only an owner or admin can connect or disconnect the calendar for this workspace.',
      { title:'Not permitted' });
    return;
  }
  if(!gcalConnected){
    window.location.href = `${BACKEND_BASE}/api/calendar?action=connect`;
    return;
  }
  if(!(await showConfirm('Disconnect Google Calendar? Events already in your calendar stay there, but Alba Business Desk will no longer be able to read or manage them.', { title:'Disconnect Google Calendar', confirmLabel:'Disconnect', danger:true }))) return;
  const btn = document.getElementById('connectGoogleCalendarBtn');
  btn.disabled = true;
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=disconnect`, {
      method:'POST', credentials:'include',
      headers:{ 'X-CSRF-Token': getCsrfToken() }
    });
    const data = await res.json();
    if(!res.ok) await showAlert(data.error || 'Could not disconnect.');
  }catch(err){
    await showAlert('Could not reach the calendar backend.');
  }
  btn.disabled = false;
  refreshGcalStatus();
});

/* ---------- Month grid ---------- */
function ymdLocal(d){
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
// The 42 dates (6 weeks) that make up the visible grid for a given month,
// including the leading/trailing days from adjacent months that fill it out.
function computeMonthGridDays(viewDate){
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const days = [];
  for(let i=0;i<42;i++){
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate()+i);
    days.push(d);
  }
  return days;
}

async function loadCalendarEvents(){
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--graphite);font-size:13px;">Loading…</div>`;
  const days = computeMonthGridDays(calendarViewDate);
  const rangeStart = days[0];
  const rangeDays = 43; // covers all 42 grid cells inclusive
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=list-events&timeMin=${encodeURIComponent(rangeStart.toISOString())}&days=${rangeDays}`, { credentials:'include' });
    const data = await res.json();
    if(!res.ok){
      grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--graphite);font-size:13px;">${escapeHtml(data.error||'Could not load events.')}</div>`;
      return;
    }
    calendarEventsCache = data.events || [];
    renderCalendarGrid();
  }catch(err){
    grid.innerHTML = `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--graphite);font-size:13px;">Could not reach the calendar backend.</div>`;
  }
}
document.getElementById('refreshCalendarEventsBtn').addEventListener('click', loadCalendarEvents);

function renderCalendarGrid(){
  document.getElementById('calMonthLabel').textContent = calendarViewDate.toLocaleDateString('en-ZA', { month:'long', year:'numeric' });
  const grid = document.getElementById('calendarGrid');
  const days = computeMonthGridDays(calendarViewDate);
  const todayStr = ymdLocal(new Date());
  const currentMonth = calendarViewDate.getMonth();

  const eventsByDay = {};
  calendarEventsCache.forEach(ev=>{
    if(!ev.start) return;
    const key = ymdLocal(new Date(ev.start));
    (eventsByDay[key] = eventsByDay[key]||[]).push(ev);
  });
  Object.values(eventsByDay).forEach(list=>list.sort((a,b)=> new Date(a.start)-new Date(b.start)));

  grid.innerHTML = days.map(d=>{
    const key = ymdLocal(d);
    const inMonth = d.getMonth()===currentMonth;
    const isToday = key===todayStr;
    const dayEvents = eventsByDay[key] || [];
    const visible = dayEvents.slice(0,3);
    const moreCount = dayEvents.length - visible.length;
    return `<div class="cal-day ${inMonth?'':'cal-day-outside'} ${isToday?'cal-day-today':''}" data-cal-day="${key}">
      <div class="cal-day-num">${d.getDate()}</div>
      <div class="cal-day-events">
        ${visible.map(ev=>`<div class="cal-chip${ev.status==='cancelled'?' cal-chip-cancelled':''}" data-cal-event="${ev.id}">${escapeHtml(ev.summary)}</div>`).join('')}
        ${moreCount>0?`<div class="cal-chip-more" data-cal-day-more="${key}">+${moreCount} more</div>`:''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-cal-day]').forEach(cell=>{
    cell.addEventListener('click', e=>{
      if(e.target.closest('[data-cal-event]')) return; // handled separately below
      openDayView(cell.dataset.calDay);
    });
  });
  grid.querySelectorAll('[data-cal-event]').forEach(chip=>{
    chip.addEventListener('click', e=>{
      e.stopPropagation();
      const ev = calendarEventsCache.find(x=>x.id===chip.dataset.calEvent);
      if(ev) openCalendarEventModal(ev);
    });
  });
}

document.getElementById('calPrevMonthBtn').addEventListener('click', ()=>{
  calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth()-1, 1);
  loadCalendarEvents();
});
document.getElementById('calNextMonthBtn').addEventListener('click', ()=>{
  calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth()+1, 1);
  loadCalendarEvents();
});
document.getElementById('calTodayBtn').addEventListener('click', ()=>{
  calendarViewDate = new Date();
  loadCalendarEvents();
});

/* ---------- Day view (browse a day's events, jump to add/edit) ---------- */
let dayViewDateKey = null;
function openDayView(dateKey){
  dayViewDateKey = dateKey;
  const d = new Date(dateKey + 'T00:00:00');
  document.getElementById('dayViewTitle').textContent = d.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long' });
  const isPastDay = dateKey < ymdLocal(new Date());
  const addBtn = document.getElementById('dayViewAddEventBtn');
  addBtn.style.display = isPastDay ? 'none' : 'inline-flex';
  const dayEvents = calendarEventsCache
    .filter(ev => ev.start && ymdLocal(new Date(ev.start)) === dateKey)
    .sort((a,b)=> new Date(a.start)-new Date(b.start));
  const list = document.getElementById('dayViewEventsList');
  const emptyEl = document.getElementById('dayViewEmpty');
  emptyEl.style.display = dayEvents.length ? 'none' : 'block';
  emptyEl.querySelector('p').textContent = isPastDay
    ? "Nothing was on the calendar this day — and since it's already passed, you can view past events here but can't add new ones."
    : "No events on this day yet.";
  list.innerHTML = dayEvents.map(ev=>{
    const start = new Date(ev.start);
    const timeLabel = ev.allDay ? 'All day' : start.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'});
    return `<div class="day-view-row" data-day-view-event="${ev.id}">
      <div class="day-view-time">${timeLabel}</div>
      <div style="flex:1;">
        <div class="day-view-title">${escapeHtml(ev.summary)}</div>
        ${ev.meetLink ? `<div class="topbar-sub" style="font-size:11.5px;">Has a Meet link</div>` : ''}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-day-view-event]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const ev = calendarEventsCache.find(x=>x.id===row.dataset.dayViewEvent);
      if(ev){ closeModals(); openCalendarEventModal(ev); }
    });
  });
  document.getElementById('dayViewModalOverlay').classList.add('active');
}
document.getElementById('dayViewAddEventBtn').addEventListener('click', ()=>{
  const dateKey = dayViewDateKey;
  closeModals();
  openCalendarEventModal(null, dateKey);
});

/* ---------- Create / edit modal ---------- */
let editingCalendarEventId = null;
function toLocalInputValue(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openCalendarEventModal(ev, presetDateKey){
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
  } else if(presetDateKey){
    // Opened from a day-view "Add event" — default to a sensible time on that specific day.
    const base = new Date(presetDateKey + 'T09:00:00');
    const later = new Date(base.getTime() + 30*60000);
    document.getElementById('ceStart').value = toLocalInputValue(base.toISOString());
    document.getElementById('ceEnd').value = toLocalInputValue(later.toISOString());
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
  if(!requireSubscriptionForAction()) return;
  const summary = document.getElementById('ceSummary').value.trim();
  const startVal = document.getElementById('ceStart').value;
  const endVal = document.getElementById('ceEnd').value;
  if(!summary || !startVal || !endVal){ await showAlert('Please fill in a title, start time, and end time.'); return; }
  const start = new Date(startVal), end = new Date(endVal);
  if(end <= start){ await showAlert('The end time needs to be after the start time.'); return; }
  if(!editingCalendarEventId && start.getTime() < Date.now() - 60*1000){
    await showAlert("That time has already passed — pick a time today or later to create a new event.");
    return;
  }

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
    if(!res.ok){ await showAlert(data.error || 'Could not save this event.'); btn.disabled=false; btn.textContent='Save event'; return; }
    logActivity(editingCalendarEventId ? `Updated calendar event "${summary}"` : `Created calendar event "${summary}"`);
    closeModals();
    loadCalendarEvents();
  }catch(err){
    await showAlert('Could not reach the calendar backend.');
  }
  btn.disabled = false; btn.textContent = 'Save event';
});

document.getElementById('deleteCalendarEventBtn').addEventListener('click', async ()=>{
  if(!editingCalendarEventId) return;
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('Delete this event from your Google Calendar? This cannot be undone.', { title:'Delete event', confirmLabel:'Delete', danger:true }))) return;
  try{
    const res = await fetch(`${BACKEND_BASE}/api/calendar?action=delete-event`, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ eventId: editingCalendarEventId })
    });
    const data = await res.json();
    if(!res.ok){ await showAlert(data.error || 'Could not delete this event.'); return; }
    closeModals();
    loadCalendarEvents();
  }catch(err){
    await showAlert('Could not reach the calendar backend.');
  }
});
