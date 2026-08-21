/* How many activity entries the dashboard feed shows. Grows as older pages
   are loaded — the feed starts at 8 so it stays a summary, not a wall. */
let activityFeedLimit = 8;

// Dashboard tab.

/* ---------- Render: Dashboard ---------- */
function renderDashboard(){
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
