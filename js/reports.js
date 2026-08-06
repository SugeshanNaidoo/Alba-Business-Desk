// Reports tab.

/* ---------- Reports ---------- */
function renderReports(){
  const wonDeals = DATA.deals.filter(d=>d.stage==='Won');
  const lostDeals = DATA.deals.filter(d=>d.stage==='Lost');
  const decided = wonDeals.length + lostDeals.length;
  const winRate = decided ? Math.round((wonDeals.length/decided)*100) : 0;
  const avgDealSize = wonDeals.length ? wonDeals.reduce((s,d)=>s+Number(d.value||0),0)/wonDeals.length : 0;
  const cycles = wonDeals.map(d=>{
    const start = d.createdAt, end = d.closeDate ? new Date(d.closeDate).getTime() : d.createdAt;
    return Math.max(0, Math.round((end-start)/86400000));
  });
  const avgCycle = cycles.length ? Math.round(cycles.reduce((a,b)=>a+b,0)/cycles.length) : 0;

  document.getElementById('reportStatGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value">${winRate}%</div><div class="stat-delta">${wonDeals.length} won &middot; ${lostDeals.length} lost</div></div>
    <div class="stat-card"><div class="stat-label">Average deal size</div><div class="stat-value">${fmtMoney(Math.round(avgDealSize))}</div><div class="stat-delta">across closed-won deals</div></div>
    <div class="stat-card"><div class="stat-label">Average sales cycle</div><div class="stat-value">${avgCycle} days</div><div class="stat-delta">lead created to close</div></div>
  `;

  // Funnel: how many deals have ever reached each stage (from stage history), with
  // conversion % to the next stage — a truer picture than just "currently sitting here"
  const funnelStages = DATA.stages.filter(s=>s!=='Lost');
  const funnelCounts = funnelStages.map(s=>DATA.deals.filter(d=>(d.stageHistory||[]).some(h=>h.stage===s)).length);
  const maxCount = Math.max(1, ...funnelCounts);
  const fw=500, barH=28, gap=14, top=20;
  let fsvg = '';
  funnelStages.forEach((s,i)=>{
    const w = Math.max(30, (funnelCounts[i]/maxCount) * (fw-140));
    const y = top + i*(barH+gap);
    const x = (fw-140-w)/2 + 70;
    const conv = i>0 && funnelCounts[i-1]>0 ? Math.round((funnelCounts[i]/funnelCounts[i-1])*100) : null;
    fsvg += `<rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="6" fill="var(--flow-soft)" stroke="var(--flow)" stroke-width="1.2"/>`;
    fsvg += `<text x="10" y="${y+barH/2+4}" font-size="12" fill="var(--graphite)">${s}${conv!==null?` <tspan fill="var(--graphite-soft)" font-size="10">(${conv}% from prior)</tspan>`:''}</text>`;
    fsvg += `<text x="${fw-8}" y="${y+barH/2+4}" font-size="12" font-weight="700" text-anchor="end" fill="var(--flow)">${funnelCounts[i]}</text>`;
  });
  document.getElementById('funnelSvg').innerHTML = fsvg;

  // Revenue trend: won revenue per month, last 6 months
  const months = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({label:d.toLocaleDateString('en-ZA',{month:'short'}), year:d.getFullYear(), month:d.getMonth()});
  }
  const monthTotals = months.map(m=>
    wonDeals.filter(d=>{
      const dt = d.closeDate ? new Date(d.closeDate) : new Date(d.createdAt);
      return dt.getFullYear()===m.year && dt.getMonth()===m.month;
    }).reduce((s,d)=>s+Number(d.value||0),0)
  );
  const maxTotal = Math.max(1, ...monthTotals);
  const tw=500, th=260, tPad=30, barW=48, tGap=(tw-tPad*2)/6;
  let tsvg = '';
  months.forEach((m,i)=>{
    const h = (monthTotals[i]/maxTotal) * 170;
    const x = tPad + i*tGap + (tGap-barW)/2;
    const y = 200-h;
    tsvg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.2"/>`;
    tsvg += `<text x="${x+barW/2}" y="218" font-size="11" text-anchor="middle" fill="var(--graphite)">${m.label}</text>`;
    if(monthTotals[i]>0) tsvg += `<text x="${x+barW/2}" y="${y-6}" font-size="10" text-anchor="middle" fill="var(--accent)">${fmtMoney(monthTotals[i])}</text>`;
  });
  document.getElementById('trendSvg').innerHTML = tsvg;

  renderTargetsProgress();
  renderTeamPerformance();
  renderLostReasons();
  renderForecast();
  renderVelocity();
}

function periodEnd(startDate, period){
  const d = new Date(startDate);
  if(period==='monthly') d.setMonth(d.getMonth()+1);
  else if(period==='quarterly') d.setMonth(d.getMonth()+3);
  else if(period==='annual') d.setFullYear(d.getFullYear()+1);
  return d;
}
function renderTargetsProgress(){
  const wonDeals = DATA.deals.filter(d=>d.stage==='Won');
  const container = document.getElementById('targetsProgress');
  if(!DATA.salesTargets.length){
    container.innerHTML = '<p class="topbar-sub">No targets set yet — add one in Settings → Sales.</p>';
    return;
  }
  container.innerHTML = DATA.salesTargets.map(t=>{
    const start = new Date(t.startDate);
    const end = periodEnd(t.startDate, t.period);
    const relevant = wonDeals.filter(d=>{
      if(t.memberId!=='team' && d.assignedTo!==t.memberId) return false;
      const cd = d.closeDate ? new Date(d.closeDate) : new Date(d.createdAt);
      return cd>=start && cd<end;
    });
    const actual = relevant.reduce((s,d)=>s+Number(d.value||0),0);
    const pct = t.amount ? Math.min(100, Math.round((actual/t.amount)*100)) : 0;
    const over = t.amount>0 && actual>=t.amount;
    const name = t.memberId==='team' ? 'Whole team' : ((DATA.teamMembers.find(m=>m.id===t.memberId)||{}).name || 'Unknown member');
    return `<div class="target-row">
      <div class="target-row-head">
        <span class="target-row-name">${escapeHtml(name)} <span class="topbar-sub" style="font-size:11px;">(${t.period})</span></span>
        <span class="target-row-amounts">${fmtMoney(actual)} / ${fmtMoney(t.amount)}</span>
      </div>
      <div class="target-bar-track"><div class="target-bar-fill ${over?'over':''}" style="width:${pct}%;"></div></div>
    </div>`;
  }).join('');
}

function renderTeamPerformance(){
  const wonDeals = DATA.deals.filter(d=>d.stage==='Won');
  const lostDeals = DATA.deals.filter(d=>d.stage==='Lost');
  let buckets = DATA.teamMembers.map(m=>({id:m.id, name:m.name}));
  const hasUnassigned = DATA.deals.some(d=>!d.assignedTo && (d.stage==='Won'||d.stage==='Lost'));
  if(hasUnassigned) buckets.push({id:null, name:'Unassigned'});
  const stats = buckets.map(b=>{
    const won = wonDeals.filter(d=>d.assignedTo===b.id);
    const lost = lostDeals.filter(d=>d.assignedTo===b.id);
    const decided = won.length+lost.length;
    return { name:b.name, revenue: won.reduce((s,d)=>s+Number(d.value||0),0), wonCount:won.length, winRate: decided?Math.round(won.length/decided*100):0 };
  });
  const maxRev = Math.max(1, ...stats.map(s=>s.revenue));
  const w=500, barH=22, gap=13, top=10, leftPad=104;
  let svg = '';
  stats.forEach((s,i)=>{
    const bw = Math.max(2, (s.revenue/maxRev)*(w-leftPad-70));
    const y = top+i*(barH+gap);
    svg += `<text x="0" y="${y+barH/2+4}" font-size="12" fill="var(--graphite)">${escapeHtml(s.name)}</text>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.2"/>`;
    svg += `<text x="${leftPad+bw+8}" y="${y+barH/2+4}" font-size="11" fill="var(--accent)">${fmtMoney(s.revenue)}</text>`;
  });
  document.getElementById('teamPerfSvg').innerHTML = svg;
  document.getElementById('teamPerfTable').innerHTML = stats.length ? `
    <table><thead><tr><th>Member</th><th>Won</th><th>Win rate</th></tr></thead>
    <tbody>${stats.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${s.wonCount}</td><td>${s.winRate}%</td></tr>`).join('')}</tbody></table>
  ` : '<p class="topbar-sub">Add team members in Settings → Sales, then assign deals to see performance here.</p>';
}

function renderLostReasons(){
  const lostDeals = DATA.deals.filter(d=>d.stage==='Lost');
  let items = DATA.lostReasons.map(r=>({name:r.name, count: lostDeals.filter(d=>d.lostReason===r.id).length}));
  const unspecified = lostDeals.filter(d=>!d.lostReason).length;
  if(unspecified) items.push({name:'Not specified', count:unspecified});
  items = items.filter(i=>i.count>0).sort((a,b)=>b.count-a.count);
  const svgEl = document.getElementById('lostReasonSvg');
  if(!items.length){ svgEl.innerHTML = `<text x="10" y="30" font-size="12" fill="var(--graphite)">No lost deals yet.</text>`; return; }
  const max = Math.max(1, ...items.map(i=>i.count));
  const w=500, barH=22, gap=13, top=10, leftPad=130;
  let svg = '';
  items.forEach((it,i)=>{
    const bw = Math.max(2, (it.count/max)*(w-leftPad-40));
    const y = top+i*(barH+gap);
    svg += `<text x="0" y="${y+barH/2+4}" font-size="12" fill="var(--graphite)">${escapeHtml(it.name)}</text>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="var(--clay-soft)" stroke="var(--clay)" stroke-width="1.2"/>`;
    svg += `<text x="${leftPad+bw+8}" y="${y+barH/2+4}" font-size="11" font-weight="700" fill="var(--clay)">${it.count}</text>`;
  });
  svgEl.innerHTML = svg;
}

function renderForecast(){
  const openDeals = DATA.deals.filter(d=>d.stage!=='Won'&&d.stage!=='Lost');
  const months = []; const now = new Date();
  for(let i=0;i<6;i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    months.push({label:d.toLocaleDateString('en-ZA',{month:'short'}), year:d.getFullYear(), month:d.getMonth()});
  }
  const totals = months.map(m=>
    openDeals.filter(d=>{
      if(!d.closeDate) return false;
      const cd = new Date(d.closeDate);
      return cd.getFullYear()===m.year && cd.getMonth()===m.month;
    }).reduce((s,d)=>{
      const p = d.probability!==undefined ? d.probability : suggestedProbability(d.stage);
      return s + Number(d.value||0)*(p/100);
    },0)
  );
  const max = Math.max(1, ...totals);
  const w=500, barW=48, tPad=30, tGap=(w-tPad*2)/6;
  let svg = '';
  months.forEach((m,i)=>{
    const h = (totals[i]/max)*140;
    const x = tPad + i*tGap + (tGap-barW)/2;
    const y = 170-h;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" fill="var(--flow-soft)" stroke="var(--flow)" stroke-width="1.2"/>`;
    svg += `<text x="${x+barW/2}" y="188" font-size="11" text-anchor="middle" fill="var(--graphite)">${m.label}</text>`;
    if(totals[i]>0) svg += `<text x="${x+barW/2}" y="${y-6}" font-size="10" text-anchor="middle" fill="var(--flow)">${fmtMoney(Math.round(totals[i]))}</text>`;
  });
  document.getElementById('forecastSvg').innerHTML = svg;
}

function renderVelocity(){
  const stages = DATA.stages.filter(s=>s!=='Lost');
  const durations = {}; stages.forEach(s=>durations[s]=[]);
  DATA.deals.forEach(d=>{
    const hist = (d.stageHistory||[]).slice().sort((a,b)=>a.enteredAt-b.enteredAt);
    for(let i=0;i<hist.length;i++){
      const stage = hist[i].stage;
      if(!(stage in durations)) continue;
      const start = hist[i].enteredAt;
      const end = i+1<hist.length ? hist[i+1].enteredAt : Date.now();
      durations[stage].push(Math.max(0,(end-start)/86400000));
    }
  });
  const items = stages.map(s=>({stage:s, avg: durations[s].length ? durations[s].reduce((a,b)=>a+b,0)/durations[s].length : 0}));
  const max = Math.max(1, ...items.map(i=>i.avg));
  const w=500, barH=22, gap=13, top=10, leftPad=104;
  let svg = '';
  items.forEach((it,i)=>{
    const bw = Math.max(2, (it.avg/max)*(w-leftPad-60));
    const y = top+i*(barH+gap);
    svg += `<text x="0" y="${y+barH/2+4}" font-size="12" fill="var(--graphite)">${escapeHtml(it.stage)}</text>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="var(--gold-soft)" stroke="var(--gold)" stroke-width="1.2"/>`;
    svg += `<text x="${leftPad+bw+8}" y="${y+barH/2+4}" font-size="11" fill="var(--gold)">${Math.round(it.avg)}d</text>`;
  });
  document.getElementById('velocitySvg').innerHTML = svg;
}

