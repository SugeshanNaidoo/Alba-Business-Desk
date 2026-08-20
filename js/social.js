// Social tab.

/* ---------- Social ---------- */
// Only the three platforms with real, working sync integrations are
// offered. Colours for previously-removed platforms are kept so any
// workspace that already has one saved still renders sensibly rather than
// falling back to grey — platformColor() also has a safe default.
const PLATFORM_COLORS = {
  'Instagram':'#E1306C','Facebook':'#1877F2','TikTok':'#000000',
  'X (Twitter)':'#000000','LinkedIn':'#0A66C2',
  'YouTube':'#FF0000','Pinterest':'#E60023','Threads':'#000000','Other':'#6E6E73'
};
function platformById(id){ return DATA.socialPlatforms.find(p=>p.id===id); }
function platformColor(name){ return PLATFORM_COLORS[name] || '#6E6E73'; }

/* Brand marks for the platforms we integrate with, drawn as single white
   paths so they sit on the platform's own brand colour. Anything without a
   mark (legacy platforms from before the list was trimmed) falls back to
   its first letter, so existing workspaces never render an empty badge. */
const PLATFORM_ICONS = {
  'Instagram':'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.86s0 3.6-.07 4.86c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.86.07s-3.6 0-4.86-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.86c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5.01-4.74.07-.9.04-1.38.19-1.7.31-.43.17-.73.37-1.05.69-.32.32-.52.62-.69 1.05-.12.32-.27.8-.31 1.7C3.45 8.5 3.44 8.85 3.44 12s.01 3.5.07 4.74c.04.9.19 1.38.31 1.7.17.43.37.73.69 1.05.32.32.62.52 1.05.69.32.12.8.27 1.7.31 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.9-.04 1.38-.19 1.7-.31.43-.17.73-.37 1.05-.69.32-.32.52-.62.69-1.05.12-.32.27-.8.31-1.7.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.9-.19-1.38-.31-1.7a2.83 2.83 0 0 0-.69-1.05 2.83 2.83 0 0 0-1.05-.69c-.32-.12-.8-.27-1.7-.31C15.5 4.01 15.15 4 12 4zm0 3.03a4.97 4.97 0 1 1 0 9.94 4.97 4.97 0 0 1 0-9.94zm0 1.8a3.17 3.17 0 1 0 0 6.34 3.17 3.17 0 0 0 0-6.34zm6.34-.35a1.16 1.16 0 1 1-2.32 0 1.16 1.16 0 0 1 2.32 0z"/></svg>',
  'Facebook':'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 22v-8.4h2.9l.44-3.3H14.5V8.2c0-.95.27-1.6 1.66-1.6h1.77V3.65c-.31-.04-1.36-.13-2.58-.13-2.56 0-4.31 1.55-4.31 4.4v2.38H8.13v3.3h2.91V22z"/></svg>',
  'TikTok':'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.1 2.5c.44 1.06 1.5 1.9 2.7 2.05v2.5c-1.06 0-2.1-.35-3.05-.95v5.24c0 2.68-2.2 4.85-4.92 4.85S5.9 14.02 5.9 11.34c0-2.6 2.06-4.72 4.64-4.84v2.5c-1.2.12-2.14 1.1-2.14 2.34a2.37 2.37 0 0 0 4.74 0V2.5z"/></svg>'
};
function platformIcon(name){
  return PLATFORM_ICONS[name] || escapeHtml((name||'?').charAt(0).toUpperCase());
}
function postEngagement(post){ return Number(post.likes||0)+Number(post.comments||0)+Number(post.shares||0); }
function snapshotsFor(platformId){
  return DATA.socialSnapshots.filter(s=>s.platformId===platformId).sort((a,b)=>a.date.localeCompare(b.date));
}

function renderSocial(){
  renderSocialStats();
  renderPlatforms();
  renderGrowthChart();
  renderPlatformComparison();
  renderTopPosts();
  renderBestTime();
  renderPosts();
  renderMentions();
}

function renderSocialStats(){
  const totalFollowers = DATA.socialPlatforms.reduce((s,p)=>s+Number(p.followers||0),0);
  const totalEngagement = DATA.socialPosts.reduce((s,p)=>s+postEngagement(p),0);
  const avgEngagement = DATA.socialPosts.length ? Math.round(totalEngagement/DATA.socialPosts.length) : 0;
  const monthAgo = Date.now()-30*86400000;
  const recentMentions = DATA.socialMentions.filter(m=>new Date(m.date).getTime() >= monthAgo).length;
  document.getElementById('socialStatGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total followers</div><div class="stat-value">${totalFollowers.toLocaleString()}</div><div class="stat-delta">across ${DATA.socialPlatforms.length} platform${DATA.socialPlatforms.length===1?'':'s'}</div></div>
    <div class="stat-card"><div class="stat-label">Avg. engagement / post</div><div class="stat-value">${avgEngagement.toLocaleString()}</div><div class="stat-delta">likes + comments + shares</div></div>
    <div class="stat-card"><div class="stat-label">Mentions this month</div><div class="stat-value">${recentMentions}</div><div class="stat-delta">${DATA.socialMentions.length} logged in total</div></div>
  `;
}

const SYNCABLE_PLATFORMS = { 'Instagram':'instagram', 'Facebook':'facebook', 'TikTok':'tiktok' };
function renderPlatforms(){
  const grid = document.getElementById('platformGrid');
  document.getElementById('platformsEmpty').style.display = DATA.socialPlatforms.length ? 'none' : 'block';
  grid.innerHTML = DATA.socialPlatforms.map(p=>{
    const snaps = snapshotsFor(p.id);
    let delta = null;
    if(snaps.length >= 2){ delta = snaps[snaps.length-1].followers - snaps[snaps.length-2].followers; }
    const deltaHtml = delta===null ? '' : `<div class="platform-delta ${delta>=0?'up':'down'}">${delta>=0?'+':''}${delta.toLocaleString()} since last update</div>`;
    const canSync = !!SYNCABLE_PLATFORMS[p.name];
    return `<div class="platform-card" data-platform="${p.id}">
      <div class="platform-badge" style="background:${platformColor(p.name)};">${platformIcon(p.name)}</div>
      <div class="platform-name">${escapeHtml(p.name)}</div>
      <div class="platform-handle">${escapeHtml(p.handle||'')}</div>
      <div class="platform-followers">${Number(p.followers||0).toLocaleString()}</div>
      ${deltaHtml}
      <div class="platform-actions">
        <button class="btn btn-ghost btn-sm" data-snapshot="${p.id}">Update followers</button>
        ${canSync ? `<button class="btn btn-primary btn-sm" data-sync="${p.id}">Sync now</button>` : ''}
      </div>
      <div class="topbar-sub" id="syncStatus-${p.id}" style="margin-top:8px;font-size:11px;"></div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.platform-card').forEach(card=>{
    card.addEventListener('click', e=>{
      if(e.target.closest('[data-snapshot]') || e.target.closest('[data-sync]')) return;
      openPlatformModal(card.dataset.platform);
    });
  });
  grid.querySelectorAll('[data-snapshot]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); openSnapshotModal(btn.dataset.snapshot); });
  });
  grid.querySelectorAll('[data-sync]').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); syncPlatform(btn.dataset.sync); });
  });
}

async function syncPlatform(platformId){
  const p = platformById(platformId);
  if(!p) return;
  const endpoint = SYNCABLE_PLATFORMS[p.name];
  if(!endpoint) return;
  if(!requireSubscriptionForAction()) return;
  const apiBase = BACKEND_BASE;
  const statusEl = document.getElementById(`syncStatus-${platformId}`);
  if(statusEl) statusEl.textContent = 'Syncing…';
  try{
    const res = await fetch(`${apiBase}/api/social-sync?platform=${endpoint}`, { credentials:'include' });
    const data = await res.json();
    if(!res.ok){ throw new Error(data.error || 'Sync failed'); }

    let newPosts = 0, newMentions = 0;
    if(typeof data.followers === 'number'){
      p.followers = data.followers;
      DATA.socialSnapshots.push({id:uid('ss'), platformId:p.id, followers:data.followers, date:new Date().toISOString().slice(0,10)});
    }
    (data.posts||[]).forEach(dp=>{
      const exists = DATA.socialPosts.some(sp=>sp.externalId && sp.externalId===dp.externalId && sp.platformId===platformId);
      if(exists) return;
      DATA.socialPosts.push({
        id:uid('post'), platformId, externalId:dp.externalId,
        caption:dp.caption||'', postedAt:dp.postedAt||new Date().toISOString(),
        likes:dp.likes||0, comments:dp.comments||0, shares:dp.shares||0, reach:dp.reach||null,
        createdAt:Date.now()
      });
      newPosts++;
    });
    (data.mentions||[]).forEach(dm=>{
      const exists = DATA.socialMentions.some(sm=>sm.externalId && sm.externalId===dm.externalId && sm.platformId===platformId);
      if(exists) return;
      DATA.socialMentions.push({
        id:uid('m'), platformId, externalId:dm.externalId,
        account:dm.account||'Unknown', note:dm.note||'', url:dm.url||'',
        date:dm.date||new Date().toISOString().slice(0,10), createdAt:Date.now()
      });
      newMentions++;
    });
    logActivity(`Synced ${p.name} — ${newPosts} new post${newPosts===1?'':'s'}${newMentions?`, ${newMentions} new mention${newMentions===1?'':'s'}`:''}`);
    saveData(DATA);
    renderAll();
    const freshStatusEl = document.getElementById(`syncStatus-${platformId}`);
    if(freshStatusEl) freshStatusEl.textContent = `Synced just now — ${newPosts} new post${newPosts===1?'':'s'}.`;
  }catch(err){
    if(statusEl) statusEl.textContent = `Sync failed — ${err.message || 'please try again.'}`;
    console.error(err);
  }
}

function renderGrowthChart(){
  const svgEl = document.getElementById('growthSvg');
  const legendEl = document.getElementById('growthLegend');
  const platforms = DATA.socialPlatforms;
  if(!platforms.length){
    svgEl.innerHTML = `<text x="10" y="30" font-size="12" fill="var(--graphite)">Add a platform to see growth here.</text>`;
    legendEl.innerHTML = '';
    return;
  }
  const allDates = [...new Set(DATA.socialSnapshots.map(s=>s.date))].sort();
  if(allDates.length < 2){
    svgEl.innerHTML = `<text x="10" y="30" font-size="12" fill="var(--graphite)">Log a couple of follower updates over time to see a growth trend.</text>`;
    legendEl.innerHTML = '';
    return;
  }
  const minTime = new Date(allDates[0]).getTime();
  const maxTime = new Date(allDates[allDates.length-1]).getTime();
  const span = Math.max(1, maxTime-minTime);
  const maxFollowers = Math.max(1, ...DATA.socialSnapshots.map(s=>s.followers));

  const w=900, h=220, padL=54, padR=20, padT=16, padB=30;
  const plotW = w-padL-padR, plotH = h-padT-padB;

  let svg = '';
  const ySteps = 4;
  for(let i=0;i<=ySteps;i++){
    const val = Math.round((maxFollowers/ySteps)*i);
    const y = padT + plotH - (val/maxFollowers)*plotH;
    svg += `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${padL-8}" y="${y+4}" font-size="10" text-anchor="end" fill="var(--graphite-soft)">${val.toLocaleString()}</text>`;
  }

  let legend = '';
  platforms.forEach(p=>{
    const snaps = snapshotsFor(p.id);
    if(!snaps.length) return;
    const color = platformColor(p.name);
    const points = snaps.map(s=>{
      const x = padL + ((new Date(s.date).getTime()-minTime)/span)*plotW;
      const y = padT + plotH - (s.followers/maxFollowers)*plotH;
      return [x,y];
    });
    if(points.length===1){
      svg += `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="4" fill="${color}"/>`;
    } else {
      svg += `<polyline points="${points.map(pt=>pt.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      points.forEach(([x,y])=>{ svg += `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`; });
    }
    legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--graphite);"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeHtml(p.name)} <strong style="color:var(--ink);">${Number(p.followers||0).toLocaleString()}</strong></div>`;
  });
  svg += `<text x="${padL}" y="${h-8}" font-size="10" fill="var(--graphite-soft)">${fmtDate(allDates[0])}</text>`;
  svg += `<text x="${w-padR}" y="${h-8}" font-size="10" text-anchor="end" fill="var(--graphite-soft)">${fmtDate(allDates[allDates.length-1])}</text>`;

  svgEl.innerHTML = svg;
  legendEl.innerHTML = legend;
}

function renderPlatformComparison(){
  const svgEl = document.getElementById('platformCompareSvg');
  const stats = DATA.socialPlatforms.map(p=>{
    const posts = DATA.socialPosts.filter(post=>post.platformId===p.id);
    const avg = posts.length ? posts.reduce((s,post)=>s+postEngagement(post),0)/posts.length : 0;
    return { name:p.name, avg, color:platformColor(p.name) };
  }).filter(s=>s.avg>0);
  if(!stats.length){
    svgEl.innerHTML = `<text x="10" y="30" font-size="12" fill="var(--graphite)">Log some posts to compare platforms.</text>`;
    return;
  }
  const max = Math.max(1, ...stats.map(s=>s.avg));
  const w=500, barH=24, gap=14, top=10, leftPad=100;
  let svg = '';
  stats.forEach((s,i)=>{
    const bw = Math.max(2, (s.avg/max)*(w-leftPad-60));
    const y = top+i*(barH+gap);
    svg += `<text x="0" y="${y+barH/2+4}" font-size="12" fill="var(--graphite)">${escapeHtml(s.name)}</text>`;
    svg += `<rect x="${leftPad}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="${s.color}22" stroke="${s.color}" stroke-width="1.2"/>`;
    svg += `<text x="${leftPad+bw+8}" y="${y+barH/2+4}" font-size="11" fill="${s.color}">${Math.round(s.avg)}</text>`;
  });
  svgEl.innerHTML = svg;
}

function renderTopPosts(){
  const el = document.getElementById('topPostsList');
  const posts = DATA.socialPosts.slice().sort((a,b)=>postEngagement(b)-postEngagement(a)).slice(0,5);
  if(!posts.length){ el.innerHTML = '<p class="topbar-sub">No posts logged yet.</p>'; return; }
  el.innerHTML = posts.map((p,i)=>{
    const plat = platformById(p.platformId);
    const caption = (p.caption||'(no caption)');
    return `<div class="info-row"><span>#${i+1} ${escapeHtml(caption.length>40?caption.slice(0,40)+'…':caption)} <span class="topbar-sub" style="font-size:11px;">${plat?escapeHtml(plat.name):''}</span></span><span style="font-weight:600;">${postEngagement(p).toLocaleString()}</span></div>`;
  }).join('');
}

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TIME_BUCKETS = [
  {label:'Night', test:h=>h>=0&&h<6},
  {label:'Morning', test:h=>h>=6&&h<11},
  {label:'Midday', test:h=>h>=11&&h<15},
  {label:'Afternoon', test:h=>h>=15&&h<18},
  {label:'Evening', test:h=>h>=18&&h<24}
];
function renderBestTime(){
  const posts = DATA.socialPosts;
  const insightEl = document.getElementById('bestTimeInsight');
  if(posts.length < 3){
    insightEl.textContent = 'Log a few more posts (at least 3) and a recommendation will appear here.';
    document.getElementById('dayOfWeekSvg').innerHTML = '';
    document.getElementById('timeOfDaySvg').innerHTML = '';
    return;
  }
  // By day of week
  const dayTotals = DAY_NAMES.map(()=>({sum:0,count:0}));
  posts.forEach(p=>{
    const d = new Date(p.postedAt);
    const idx = d.getDay();
    dayTotals[idx].sum += postEngagement(p);
    dayTotals[idx].count++;
  });
  const dayAverages = dayTotals.map(t=>t.count ? t.sum/t.count : 0);
  drawBarChart('dayOfWeekSvg', DAY_NAMES, dayAverages, 'var(--flow)', 'var(--flow-soft)');

  // By time of day
  const bucketTotals = TIME_BUCKETS.map(()=>({sum:0,count:0}));
  posts.forEach(p=>{
    const d = new Date(p.postedAt);
    const h = d.getHours();
    const idx = TIME_BUCKETS.findIndex(b=>b.test(h));
    if(idx>-1){ bucketTotals[idx].sum += postEngagement(p); bucketTotals[idx].count++; }
  });
  const bucketAverages = bucketTotals.map(t=>t.count ? t.sum/t.count : 0);
  drawBarChart('timeOfDaySvg', TIME_BUCKETS.map(b=>b.label), bucketAverages, 'var(--accent)', 'var(--accent-soft)');

  const bestDayIdx = dayAverages.indexOf(Math.max(...dayAverages));
  const bestBucketIdx = bucketAverages.indexOf(Math.max(...bucketAverages));
  if(dayTotals[bestDayIdx].count && bucketTotals[bestBucketIdx].count){
    insightEl.innerHTML = `Your posts tend to get the most engagement on <strong>${DAY_NAMES[bestDayIdx]}s</strong>, during the <strong>${TIME_BUCKETS[bestBucketIdx].label.toLowerCase()}</strong> — worth scheduling your next few posts around that window.`;
  } else {
    insightEl.textContent = 'Log a few more posts and a recommendation will appear here.';
  }
}
function drawBarChart(svgId, labels, values, barColor, barSoft){
  const max = Math.max(1, ...values);
  const w=500, h=180, pad=28, barGap=(w-pad*2)/labels.length;
  const barW = Math.min(48, barGap*0.55);
  let svg = '';
  labels.forEach((label,i)=>{
    const barH = (values[i]/max) * 110;
    const x = pad + i*barGap + (barGap-barW)/2;
    const y = 140-barH;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="6" fill="${barSoft}" stroke="${barColor}" stroke-width="1.2"/>`;
    svg += `<text x="${x+barW/2}" y="158" font-size="11" text-anchor="middle" fill="var(--graphite)">${label}</text>`;
    if(values[i]>0) svg += `<text x="${x+barW/2}" y="${y-6}" font-size="10" text-anchor="middle" fill="${barColor}">${Math.round(values[i])}</text>`;
  });
  document.getElementById(svgId).innerHTML = svg;
}

function renderPosts(){
  const posts = DATA.socialPosts.slice().sort((a,b)=>new Date(b.postedAt)-new Date(a.postedAt));
  const tbody = document.getElementById('postsTbody');
  document.getElementById('postsEmpty').style.display = posts.length ? 'none' : 'block';
  tbody.innerHTML = posts.map(p=>{
    const plat = platformById(p.platformId);
    const d = new Date(p.postedAt);
    return `<tr data-post="${p.id}">
      <td><span class="tag" style="background:${platformColor(plat?plat.name:'')}22;color:${platformColor(plat?plat.name:'')};">${plat?escapeHtml(plat.name):'—'}</span></td>
      <td>${d.toLocaleDateString('en-ZA',{day:'numeric',month:'short'})} &middot; ${d.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.caption||'—')}</td>
      <td>${Number(p.likes||0).toLocaleString()}</td>
      <td>${Number(p.comments||0).toLocaleString()}</td>
      <td>${Number(p.shares||0).toLocaleString()}</td>
      <td style="font-weight:600;">${postEngagement(p).toLocaleString()}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click', ()=>openPostModal(tr.dataset.post));
  });
}

function renderMentions(){
  const mentions = DATA.socialMentions.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const list = document.getElementById('mentionsList');
  document.getElementById('mentionsEmpty').style.display = mentions.length ? 'none' : 'block';
  list.innerHTML = mentions.map(m=>{
    const plat = platformById(m.platformId);
    return `<div class="mention-row" data-mention="${m.id}">
      <div style="flex:1;min-width:0;">
        <div class="mention-account">${escapeHtml(m.account)} <span class="topbar-sub" style="font-size:11px;">on ${plat?escapeHtml(plat.name):'—'}</span></div>
        <div class="mention-text">${escapeHtml(m.note||'')}</div>
      </div>
      <div class="mention-date">${fmtDate(m.date)}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.mention-row').forEach(row=>{
    row.addEventListener('click', ()=>openMentionModal(row.dataset.mention));
  });
}

/* Platform modal */
let editingPlatformId = null;
function openPlatformModal(id){
  editingPlatformId = id || null;
  const p = id ? platformById(id) : null;
  document.getElementById('platformModalTitle').textContent = p ? 'Edit platform' : 'Add platform';
  document.getElementById('pName').value = p ? p.name : 'Instagram';
  document.getElementById('pHandle').value = p ? p.handle : '';
  document.getElementById('pFollowers').value = p ? p.followers : '';
  document.getElementById('deletePlatformBtn').style.display = p ? 'inline-flex' : 'none';
  document.getElementById('platformModalOverlay').classList.add('active');
}
document.getElementById('addPlatformBtn').addEventListener('click', ()=>openPlatformModal(null));
document.getElementById('savePlatformBtn').addEventListener('click', ()=>{
  if(!requireSubscriptionForAction()) return;
  const name = document.getElementById('pName').value;
  const handle = document.getElementById('pHandle').value.trim();
  const followers = Number(document.getElementById('pFollowers').value)||0;
  if(editingPlatformId){
    Object.assign(platformById(editingPlatformId), {name, handle, followers});
  } else {
    const id = uid('sp');
    DATA.socialPlatforms.push({id, name, handle, followers, createdAt:Date.now()});
    DATA.socialSnapshots.push({id:uid('ss'), platformId:id, followers, date:new Date().toISOString().slice(0,10)});
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deletePlatformBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('Delete this platform? Its logged posts, mentions, and follower history stay but will show as unlinked.', { title:'Delete platform', confirmLabel:'Delete', danger:true }))) return;
  DATA.socialPlatforms = DATA.socialPlatforms.filter(p=>p.id!==editingPlatformId);
  saveData(DATA); closeModals(); renderAll();
});

/* Snapshot modal */
let snapshotPlatformId = null;
function openSnapshotModal(platformId){
  snapshotPlatformId = platformId;
  const p = platformById(platformId);
  document.getElementById('snapshotPlatformLabel').textContent = `${p ? p.name : 'Platform'} — current followers`;
  document.getElementById('snapFollowers').value = p ? p.followers : '';
  document.getElementById('snapDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('snapshotModalOverlay').classList.add('active');
}
document.getElementById('saveSnapshotBtn').addEventListener('click', ()=>{
  if(!requireSubscriptionForAction()) return;
  const p = platformById(snapshotPlatformId);
  if(!p) return;
  const followers = Number(document.getElementById('snapFollowers').value)||0;
  const date = document.getElementById('snapDate').value || new Date().toISOString().slice(0,10);
  p.followers = followers;
  DATA.socialSnapshots.push({id:uid('ss'), platformId:p.id, followers, date});
  logActivity(`Updated ${p.name} followers to ${followers.toLocaleString()}`);
  saveData(DATA); closeModals(); renderAll();
});

/* Post modal */
let editingPostId = null;
function refreshPlatformSelects(){
  const opts = DATA.socialPlatforms.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.handle||'')})</option>`).join('');
  document.getElementById('postPlatform').innerHTML = opts;
  document.getElementById('mentionPlatform').innerHTML = opts;
}
function openPostModal(id){
  editingPostId = id || null;
  refreshPlatformSelects();
  const p = id ? DATA.socialPosts.find(x=>x.id===id) : null;
  document.getElementById('postModalTitle').textContent = p ? 'Edit post' : 'Log a post';
  const d = p ? new Date(p.postedAt) : new Date();
  document.getElementById('postPlatform').value = p ? p.platformId : (DATA.socialPlatforms[0]?DATA.socialPlatforms[0].id:'');
  document.getElementById('postCaption').value = p ? p.caption : '';
  document.getElementById('postDate').value = d.toISOString().slice(0,10);
  document.getElementById('postTime').value = d.toTimeString().slice(0,5);
  document.getElementById('postLikes').value = p ? p.likes : '';
  document.getElementById('postComments').value = p ? p.comments : '';
  document.getElementById('postShares').value = p ? p.shares : '';
  document.getElementById('postReach').value = p ? (p.reach||'') : '';
  document.getElementById('deletePostBtn').style.display = p ? 'inline-flex' : 'none';
  document.getElementById('postModalOverlay').classList.add('active');
}
document.getElementById('addPostBtn').addEventListener('click', async ()=>{
  if(!DATA.socialPlatforms.length){ await showAlert('Add a platform first.'); openPlatformModal(null); return; }
  openPostModal(null);
});
document.getElementById('savePostBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  const platformId = document.getElementById('postPlatform').value;
  if(!platformId){ await showAlert('Add a platform first.'); return; }
  const date = document.getElementById('postDate').value;
  const time = document.getElementById('postTime').value || '12:00';
  if(!date){ await showAlert('Please set a date.'); return; }
  const postedAt = new Date(`${date}T${time}`).toISOString();
  const payload = {
    platformId,
    caption: document.getElementById('postCaption').value.trim(),
    postedAt,
    likes: Number(document.getElementById('postLikes').value)||0,
    comments: Number(document.getElementById('postComments').value)||0,
    shares: Number(document.getElementById('postShares').value)||0,
    reach: document.getElementById('postReach').value ? Number(document.getElementById('postReach').value) : null
  };
  if(editingPostId){
    Object.assign(DATA.socialPosts.find(x=>x.id===editingPostId), payload);
  } else {
    DATA.socialPosts.push({id:uid('post'), createdAt:Date.now(), ...payload});
    logActivity(`Logged a new ${platformById(platformId)?platformById(platformId).name:''} post`);
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deletePostBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('Delete this post?', { title:'Delete post', confirmLabel:'Delete', danger:true }))) return;
  DATA.socialPosts = DATA.socialPosts.filter(p=>p.id!==editingPostId);
  saveData(DATA); closeModals(); renderAll();
});

/* Mention modal */
let editingMentionId = null;
function openMentionModal(id){
  editingMentionId = id || null;
  refreshPlatformSelects();
  const m = id ? DATA.socialMentions.find(x=>x.id===id) : null;
  document.getElementById('mentionModalTitle').textContent = m ? 'Edit mention' : 'Log a mention';
  document.getElementById('mentionPlatform').value = m ? m.platformId : (DATA.socialPlatforms[0]?DATA.socialPlatforms[0].id:'');
  document.getElementById('mentionAccount').value = m ? m.account : '';
  document.getElementById('mentionDate').value = m ? m.date : new Date().toISOString().slice(0,10);
  document.getElementById('mentionNote').value = m ? m.note : '';
  document.getElementById('mentionUrl').value = m ? (m.url||'') : '';
  document.getElementById('deleteMentionBtn').style.display = m ? 'inline-flex' : 'none';
  document.getElementById('mentionModalOverlay').classList.add('active');
}
document.getElementById('addMentionBtn').addEventListener('click', async ()=>{
  if(!DATA.socialPlatforms.length){ await showAlert('Add a platform first.'); openPlatformModal(null); return; }
  openMentionModal(null);
});
document.getElementById('saveMentionBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  const platformId = document.getElementById('mentionPlatform').value;
  const account = document.getElementById('mentionAccount').value.trim();
  if(!platformId || !account){ await showAlert('Please choose a platform and enter the account that mentioned you.'); return; }
  const payload = {
    platformId, account,
    date: document.getElementById('mentionDate').value || new Date().toISOString().slice(0,10),
    note: document.getElementById('mentionNote').value.trim(),
    url: document.getElementById('mentionUrl').value.trim()
  };
  if(editingMentionId){
    Object.assign(DATA.socialMentions.find(x=>x.id===editingMentionId), payload);
  } else {
    DATA.socialMentions.push({id:uid('m'), createdAt:Date.now(), ...payload});
    logActivity(`Logged a mention from ${account}`);
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deleteMentionBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('Delete this mention?', { title:'Delete mention', confirmLabel:'Delete', danger:true }))) return;
  DATA.socialMentions = DATA.socialMentions.filter(m=>m.id!==editingMentionId);
  saveData(DATA); closeModals(); renderAll();
});

