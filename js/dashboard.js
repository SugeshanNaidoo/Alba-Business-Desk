/* How many activity entries the dashboard feed shows. Grows as older pages
   are loaded — the feed starts at 8 so it stays a summary, not a wall. */
let activityFeedLimit = 8;

// Dashboard tab.

/* ---------- Render: Dashboard ---------- */
function renderDashboard(){
  renderOnboarding();
  const openDeals = DATA.deals.filter(d=>d.stage!=='Won'&&d.stage!=='Lost');
  const wonDeals = DATA.deals.filter(d=>d.stage==='Won');
  const pipelineValue = openDeals.reduce((s,d)=>s+Number(d.value||0),0);
  const weightedForecast = openDeals.reduce((s,d)=>{
    const p = d.probability!==undefined ? d.probability : suggestedProbability(d.stage);
    return s + Number(d.value||0) * (p/100);
  },0);
  const openTasks = DATA.tasks.filter(t=>!t.done);
  const overdue = openTasks.filter(isOverdue);

  // Revenue: based on the close date of every Won deal
  const today = new Date();
  const curMonth = today.getMonth(), curYear = today.getFullYear();
  const revenueDateOf = d => d.closeDate ? new Date(d.closeDate) : new Date(d.createdAt);
  const lifetimeRevenue = wonDeals.reduce((s,d)=>s+Number(d.value||0),0);
  const yearDeals = wonDeals.filter(d=>revenueDateOf(d).getFullYear()===curYear);
  const monthDeals = wonDeals.filter(d=>{ const dt=revenueDateOf(d); return dt.getFullYear()===curYear && dt.getMonth()===curMonth; });
  const yearRevenue = yearDeals.reduce((s,d)=>s+Number(d.value||0),0);
  const monthRevenue = monthDeals.reduce((s,d)=>s+Number(d.value||0),0);
  const monthLabel = today.toLocaleDateString('en-ZA',{month:'long'});

  document.getElementById('revenueGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Lifetime revenue</div><div class="stat-value">${fmtMoney(lifetimeRevenue)}</div><div class="stat-delta">${wonDeals.length} deals won in total</div></div>
    <div class="stat-card"><div class="stat-label">Revenue this year</div><div class="stat-value">${fmtMoney(yearRevenue)}</div><div class="stat-delta">${yearDeals.length} deals won in ${curYear}</div></div>
    <div class="stat-card"><div class="stat-label">Revenue this month</div><div class="stat-value">${fmtMoney(monthRevenue)}</div><div class="stat-delta">${monthDeals.length} deals won in ${monthLabel}</div></div>
  `;

  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Open pipeline</div><div class="stat-value">${fmtMoney(pipelineValue)}</div><div class="stat-delta">${openDeals.length} active deals</div></div>
    <div class="stat-card"><div class="stat-label">Weighted forecast</div><div class="stat-value">${fmtMoney(Math.round(weightedForecast))}</div><div class="stat-delta">adjusted for win probability</div></div>
    <div class="stat-card"><div class="stat-label">Contacts</div><div class="stat-value">${DATA.contacts.length}</div><div class="stat-delta">${DATA.contacts.filter(c=>c.tag==='Lead').length} potential clients</div></div>
    <div class="stat-card"><div class="stat-label">Open tasks</div><div class="stat-value">${openTasks.length}</div><div class="stat-delta ${overdue.length?'down':''}">${overdue.length} overdue</div></div>
  `;

  renderRiver();

  const btn = document.getElementById('loadMoreActivityBtn');
  if(btn) btn.style.display = (typeof activityHasMore === 'function' && activityHasMore()) ? 'inline-flex' : 'none';
  document.getElementById('activityList').innerHTML = DATA.activity.slice(0, activityFeedLimit).map(a=>`
    <div class="activity-row">
      <div class="activity-dot"></div>
      <div><div class="activity-text">${escapeHtml(activityText(a))}</div><div class="activity-time">${timeAgo(activityTime(a))}</div></div>
    </div>`).join('') || `<div class="empty-state"><p>No activity yet.</p></div>`;

  const upcoming = DATA.tasks.filter(t=>!t.done).sort((a,b)=>byDateStr(a.dueDate, b.dueDate)).slice(0,5);
  document.getElementById('dashTaskList').innerHTML = upcoming.map(t=>`
    <div class="task-mini ${isOverdue(t)?'overdue':''}">
      <input type="checkbox" data-task-toggle="${t.id}">
      <div class="task-mini-title">${escapeHtml(t.title)}</div>
      <div class="task-mini-due">${fmtDate(t.dueDate)}</div>
    </div>`).join('') || `<div class="empty-state"><p>You're all caught up.</p></div>`;
}

function renderRiver(){
  const stages = DATA.stages.filter(s=>s!=='Won'&&s!=='Lost');
  const counts = stages.map(s=>DATA.deals.filter(d=>d.stage===s).length);
  const values = stages.map(s=>DATA.deals.filter(d=>d.stage===s).reduce((sum,d)=>sum+Number(d.value||0),0));
  const total = DATA.deals.filter(d=>d.stage!=='Lost').reduce((s,d)=>s+Number(d.value||0),0);
  document.getElementById('riverTotal').textContent = fmtMoney(total)+' tracked';

  const w=900,h=150,n=stages.length;
  const pad=70;
  const step = n>1 ? (w-pad*2)/(n-1) : 0;
  const pts = stages.map((s,i)=>({x:pad+i*step, y: 75 - Math.sin(i*0.9)*22}));
  let path = `M ${pts[0].x} ${pts[0].y}`;
  for(let i=1;i<pts.length;i++){
    const prev=pts[i-1], cur=pts[i];
    const midX=(prev.x+cur.x)/2;
    path += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  let svg = `<path d="${path}" fill="none" stroke="var(--flow)" stroke-width="2.5" opacity="0.55"/>`;
  pts.forEach((p,i)=>{
    const r = 8 + Math.min(counts[i]*3, 22);
    svg += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="var(--flow-soft)" stroke="var(--flow)" stroke-width="1.5"/>`;
    svg += `<text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--flow)">${counts[i]}</text>`;
    svg += `<text x="${p.x}" y="${p.y+38}" text-anchor="middle" font-size="11" fill="var(--graphite)">${stages[i]}</text>`;
    svg += `<text x="${p.x}" y="${p.y+53}" text-anchor="middle" font-size="10.5" fill="var(--accent)">${fmtMoney(values[i])}</text>`;
  });
  document.getElementById('riverSvg').innerHTML = svg;
}



document.getElementById('loadMoreActivityBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('loadMoreActivityBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  const res = await loadMoreActivity();
  activityFeedLimit += 25;
  btn.disabled = false; btn.textContent = 'Load older activity';
  renderDashboard();
  if(!res.hasMore) btn.style.display = 'none';
});


/* ---- Onboarding checklist ------------------------------------------------
   Completion is DERIVED from real data, never stored as flags. A stored flag
   drifts: delete your only contact and a flag would still claim the step was
   done. Deriving it means the checklist can only ever tell the truth.

   The one thing that IS persisted is dismissal — that's a preference, not a
   fact about the data. */

// Integration status is asynchronous, so the panels that check it publish
// what they found here. Unknown reads as "not done" rather than blocking.
const INTEGRATION_STATE = { calendar:false, social:false, team:false };

function onboardingSteps(){
  const named = (DATA.settings.workspaceName || '').trim();
  return [
    { key:'name',     label:'Name your workspace',
      done: !!named && named !== 'Alba Business Desk',
      action:()=>{ showView('settings'); } },
    { key:'contact',  label:'Add your first contact',
      done: DATA.contacts.length > 0,
      action:()=>{ showView('contacts'); setTimeout(()=>document.getElementById('addContactBtn').click(), 120); } },
    { key:'deal',     label:'Create your first deal',
      done: DATA.deals.length > 0,
      action:()=>{ showView('deals'); setTimeout(()=>document.getElementById('addDealBtn').click(), 120); } },
    { key:'task',     label:'Add a task',
      done: DATA.tasks.length > 0,
      action:()=>{ showView('tasks'); setTimeout(()=>document.getElementById('addTaskBtn').click(), 120); } },
    { key:'calendar', label:'Connect Google Calendar',
      done: INTEGRATION_STATE.calendar,
      action:()=>{ showView('scheduling'); } },
    { key:'social',   label:'Connect a social account',
      done: INTEGRATION_STATE.social,
      action:()=>{ showView('settings'); } },
    { key:'team',     label:'Invite a team member',
      done: INTEGRATION_STATE.team,
      action:()=>{ showView('settings'); } }
  ];
}

/* Integration status is only known once the relevant tab has been opened, so
   on a first dashboard load a connected integration would wrongly show as
   incomplete. This fetches it once — but ONLY while the checklist is
   actually visible, which is true for new workspaces and nobody else. An
   established user who has dismissed or completed it pays nothing. */
let _onboardingStatusFetched = false;
async function fetchOnboardingStatus(){
  if(_onboardingStatusFetched || !ORG_CONTEXT) return;
  _onboardingStatusFetched = true;
  try{
    const [social, cal, team] = await Promise.all([
      fetch(`${BACKEND_BASE}/api/social-sync?action=status`, { credentials:'include' }).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`${BACKEND_BASE}/api/calendar?action=status`,     { credentials:'include' }).then(r=>r.ok?r.json():null).catch(()=>null),
      typeof listMembers === 'function' ? listMembers() : null
    ]);
    if(social) INTEGRATION_STATE.social = ['meta','instagram','tiktok'].some(k => social[k] && social[k].connected);
    if(cal)    INTEGRATION_STATE.calendar = !!cal.connected;
    if(team)   INTEGRATION_STATE.team = (team.members.filter(m=>m.status!=='removed').length + team.pending.length) > 1;
    renderOnboarding();
  }catch(err){
    // Non-fatal: the checklist just shows those steps as not yet done.
    console.error('Could not check setup status:', err);
  }
}

function renderOnboarding(){
  const panel = document.getElementById('onboardingPanel');
  if(!panel) return;

  // Hidden once dismissed, or once everything is done — a permanently
  // complete checklist is just clutter.
  // Per-user, not workspace config: one person dismissing this must not
  // hide it for their colleagues, and a member shouldn't need write access
  // to shared settings just to tidy their own dashboard.
  let dismissed = false;
  try{ dismissed = localStorage.getItem('abd_onboarding_dismissed') === '1'; }catch(e){}
  if(dismissed){ panel.style.display = 'none'; return; }

  const steps = onboardingSteps();
  const doneCount = steps.filter(s => s.done).length;
  if(doneCount === steps.length){ panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  fetchOnboardingStatus();   // once, and only while the checklist is showing
  document.getElementById('onboardingProgress').textContent = `${doneCount} of ${steps.length} done`;
  document.getElementById('onboardingBarFill').style.width = `${Math.round((doneCount/steps.length)*100)}%`;

  document.getElementById('onboardingSteps').innerHTML = steps.map((s,i)=>`
    <div class="onboarding-step ${s.done?'done':''}">
      <div class="onboarding-check">✓</div>
      <div class="onboarding-label">${escapeHtml(s.label)}</div>
      ${s.done ? '' : `<button class="btn btn-ghost btn-sm" data-onboard-step="${i}">Do it</button>`}
    </div>`).join('');

  document.querySelectorAll('[data-onboard-step]').forEach(btn=>{
    btn.addEventListener('click', ()=> steps[Number(btn.dataset.onboardStep)].action());
  });
}

document.getElementById('dismissOnboardingBtn').addEventListener('click', async ()=>{
  if(!(await showConfirm('Hide this checklist? You can still do any of these steps later — this just clears it from your dashboard.',
    { title:'Dismiss setup checklist', confirmLabel:'Hide it' }))) return;
  try{ localStorage.setItem('abd_onboarding_dismissed', '1'); }catch(e){}
  renderOnboarding();
});
