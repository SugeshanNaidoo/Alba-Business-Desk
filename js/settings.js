// Settings — all sub-sections (General, CRM setup, Sales, Social integrations, Account, Data).

/* ---------- Settings ---------- */
document.querySelectorAll('#settingsSubNav .settings-subnav-item').forEach(item=>{
  item.addEventListener('click', ()=>{
    document.querySelectorAll('#settingsSubNav .settings-subnav-item').forEach(el=>el.classList.remove('active'));
    document.querySelectorAll('.settings-section').forEach(el=>el.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('settings-'+item.dataset.settingsSection).classList.add('active');
  });
});

function renderSettings(){
  document.getElementById('settingsWorkspaceName').value = DATA.settings.workspaceName;
  refreshConnectionStatus();
  renderStatusEditor();
  renderSourceEditor();
  renderCustomFieldEditor('contact');
  renderCustomFieldEditor('deal');
  renderTeamMemberEditor();
  renderLostReasonEditor();
  renderTargetEditor();

  document.getElementById('stageEditorList').innerHTML = DATA.stages.map((s,i)=>`
    <div class="stage-editor-row">
      <input type="text" value="${escapeHtml(s)}" data-stage-index="${i}">
      <button class="btn btn-ghost btn-sm" data-remove-stage="${i}">Remove</button>
    </div>`).join('');
  document.querySelectorAll('[data-stage-index]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(inp.dataset.stageIndex);
      const oldName = DATA.stages[i];
      DATA.deals.forEach(d=>{ if(d.stage===oldName) d.stage = inp.value; });
      DATA.stages[i] = inp.value;
      saveData(DATA); renderAll();
    });
  });
  document.querySelectorAll('[data-remove-stage]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(btn.dataset.removeStage);
      if(DATA.stages.length<=1) return;
      DATA.stages.splice(i,1);
      saveData(DATA); renderSettings(); renderBoard();
    });
  });
}
document.getElementById('addStageBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.stages.push('New stage');
  saveData(DATA); renderSettings(); renderBoard();
});

/* Contact statuses */
function renderStatusEditor(){
  document.getElementById('statusEditorList').innerHTML = DATA.contactStatuses.map((s,i)=>`
    <div class="stage-editor-row">
      <input type="text" value="${escapeHtml(s.name)}" data-status-name="${i}" style="flex:2;">
      <select data-status-category="${i}" style="flex:1;">
        <option value="potential" ${s.category==='potential'?'selected':''}>Potential</option>
        <option value="client" ${s.category==='client'?'selected':''}>Client</option>
        <option value="other" ${s.category==='other'?'selected':''}>Other</option>
      </select>
      <button class="btn btn-ghost btn-sm" data-remove-status="${i}">Remove</button>
    </div>`).join('');
  document.querySelectorAll('[data-status-name]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(inp.dataset.statusName);
      const oldName = DATA.contactStatuses[i].name;
      DATA.contacts.forEach(c=>{ if(c.tag===oldName) c.tag = inp.value; });
      DATA.contactStatuses[i].name = inp.value;
      saveData(DATA); renderAll();
    });
  });
  document.querySelectorAll('[data-status-category]').forEach(sel=>{
    sel.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      DATA.contactStatuses[Number(sel.dataset.statusCategory)].category = sel.value;
      saveData(DATA); renderAll();
    });
  });
  document.querySelectorAll('[data-remove-status]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      if(DATA.contactStatuses.length<=1) return;
      DATA.contactStatuses.splice(Number(btn.dataset.removeStatus),1);
      saveData(DATA); renderAll();
    });
  });
}
document.getElementById('addStatusBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.contactStatuses.push({id:uid('st'), name:'New status', category:'other'});
  saveData(DATA); renderSettings();
});

/* Lead sources */
function renderSourceEditor(){
  document.getElementById('sourceEditorList').innerHTML = DATA.leadSources.map((s,i)=>`
    <div class="stage-editor-row">
      <input type="text" value="${escapeHtml(s.name)}" data-source-name="${i}">
      <button class="btn btn-ghost btn-sm" data-remove-source="${i}">Remove</button>
    </div>`).join('');
  document.querySelectorAll('[data-source-name]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      DATA.leadSources[Number(inp.dataset.sourceName)].name = inp.value;
      saveData(DATA); renderSettings();
    });
  });
  document.querySelectorAll('[data-remove-source]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      if(DATA.leadSources.length<=1) return;
      DATA.leadSources.splice(Number(btn.dataset.removeSource),1);
      saveData(DATA); renderSettings();
    });
  });
}
document.getElementById('addSourceBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.leadSources.push({id:uid('ls'), name:'New source'});
  saveData(DATA); renderSettings();
});

/* Team members */
function renderTeamMemberEditor(){
  document.getElementById('teamMemberEditorList').innerHTML = DATA.teamMembers.map((m,i)=>`
    <div class="stage-editor-row">
      <input type="text" value="${escapeHtml(m.name)}" data-member-name="${i}">
      <button class="btn btn-ghost btn-sm" data-remove-member="${i}">Remove</button>
    </div>`).join('') || '<p class="topbar-sub" style="margin-bottom:8px;">No team members yet — deals can still be tracked unassigned.</p>';
  document.querySelectorAll('[data-member-name]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      DATA.teamMembers[Number(inp.dataset.memberName)].name = inp.value;
      saveData(DATA); renderSettings();
    });
  });
  document.querySelectorAll('[data-remove-member]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(btn.dataset.removeMember);
      const memberId = DATA.teamMembers[i].id;
      DATA.deals.forEach(d=>{ if(d.assignedTo===memberId) d.assignedTo=null; });
      DATA.salesTargets = DATA.salesTargets.filter(t=>t.memberId!==memberId);
      DATA.teamMembers.splice(i,1);
      saveData(DATA); renderAll();
    });
  });
}
document.getElementById('addTeamMemberBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.teamMembers.push({id:uid('tm'), name:'New team member'});
  saveData(DATA); renderSettings();
});

/* Lost reasons */
function renderLostReasonEditor(){
  document.getElementById('lostReasonEditorList').innerHTML = DATA.lostReasons.map((r,i)=>`
    <div class="stage-editor-row">
      <input type="text" value="${escapeHtml(r.name)}" data-reason-name="${i}">
      <button class="btn btn-ghost btn-sm" data-remove-reason="${i}">Remove</button>
    </div>`).join('');
  document.querySelectorAll('[data-reason-name]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      DATA.lostReasons[Number(inp.dataset.reasonName)].name = inp.value;
      saveData(DATA); renderSettings();
    });
  });
  document.querySelectorAll('[data-remove-reason]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      if(DATA.lostReasons.length<=1) return;
      const i = Number(btn.dataset.removeReason);
      const reasonId = DATA.lostReasons[i].id;
      DATA.deals.forEach(d=>{ if(d.lostReason===reasonId) d.lostReason=null; });
      DATA.lostReasons.splice(i,1);
      saveData(DATA); renderAll();
    });
  });
}
document.getElementById('addLostReasonBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.lostReasons.push({id:uid('lr'), name:'New reason'});
  saveData(DATA); renderSettings();
});

/* Sales targets */
function renderTargetEditor(){
  document.getElementById('targetEditorList').innerHTML = DATA.salesTargets.map((t,i)=>`
    <div class="stage-editor-row" style="flex-wrap:wrap;">
      <select data-target-member="${i}" style="flex:1 1 140px;">
        <option value="team" ${t.memberId==='team'?'selected':''}>Whole team</option>
        ${DATA.teamMembers.map(m=>`<option value="${m.id}" ${t.memberId===m.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
      </select>
      <select data-target-period="${i}" style="flex:1 1 110px;">
        <option value="monthly" ${t.period==='monthly'?'selected':''}>Monthly</option>
        <option value="quarterly" ${t.period==='quarterly'?'selected':''}>Quarterly</option>
        <option value="annual" ${t.period==='annual'?'selected':''}>Annual</option>
      </select>
      <input type="number" value="${t.amount}" placeholder="Target amount" data-target-amount="${i}" style="flex:1 1 120px;">
      <input type="date" value="${t.startDate}" data-target-start="${i}" style="flex:1 1 140px;">
      <button class="btn btn-ghost btn-sm" data-remove-target="${i}">Remove</button>
    </div>`).join('') || '<p class="topbar-sub" style="margin-bottom:8px;">No targets set yet.</p>';
  document.querySelectorAll('[data-target-member]').forEach(sel=>{
    sel.addEventListener('change',()=>{ if(!requireSubscriptionForAction()) return; DATA.salesTargets[Number(sel.dataset.targetMember)].memberId = sel.value; saveData(DATA); renderReports(); });
  });
  document.querySelectorAll('[data-target-period]').forEach(sel=>{
    sel.addEventListener('change',()=>{ if(!requireSubscriptionForAction()) return; DATA.salesTargets[Number(sel.dataset.targetPeriod)].period = sel.value; saveData(DATA); renderReports(); });
  });
  document.querySelectorAll('[data-target-amount]').forEach(inp=>{
    inp.addEventListener('change',()=>{ if(!requireSubscriptionForAction()) return; DATA.salesTargets[Number(inp.dataset.targetAmount)].amount = Number(inp.value)||0; saveData(DATA); renderReports(); });
  });
  document.querySelectorAll('[data-target-start]').forEach(inp=>{
    inp.addEventListener('change',()=>{ if(!requireSubscriptionForAction()) return; DATA.salesTargets[Number(inp.dataset.targetStart)].startDate = inp.value; saveData(DATA); renderReports(); });
  });
  document.querySelectorAll('[data-remove-target]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      DATA.salesTargets.splice(Number(btn.dataset.removeTarget),1);
      saveData(DATA); renderSettings(); renderReports();
    });
  });
}
document.getElementById('addTargetBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.salesTargets.push({id:uid('tg'), memberId:'team', period:'monthly', amount:0, startDate:new Date().toISOString().slice(0,8)+'01'});
  saveData(DATA); renderSettings();
});

/* Custom fields (shared renderer for contact/deal) */
function renderCustomFieldEditor(entity){
  const listEl = document.getElementById(entity==='contact' ? 'contactFieldEditorList' : 'dealFieldEditorList');
  const defs = DATA.customFieldDefs[entity];
  listEl.innerHTML = defs.map((f,i)=>`
    <div class="stage-editor-row" style="flex-wrap:wrap;">
      <input type="text" value="${escapeHtml(f.label)}" placeholder="Field label" data-cf-label="${entity}:${i}" style="flex:2;min-width:110px;">
      <select data-cf-type="${entity}:${i}" style="flex:1;min-width:90px;">
        <option value="text" ${f.type==='text'?'selected':''}>Text</option>
        <option value="number" ${f.type==='number'?'selected':''}>Number</option>
        <option value="date" ${f.type==='date'?'selected':''}>Date</option>
        <option value="select" ${f.type==='select'?'selected':''}>Dropdown</option>
      </select>
      <button class="btn btn-ghost btn-sm" data-cf-remove="${entity}:${i}">Remove</button>
      ${f.type==='select' ? `<input type="text" value="${escapeHtml((f.options||[]).join(', '))}" placeholder="Options, comma separated" data-cf-options="${entity}:${i}" style="flex:1 1 100%;">` : ''}
    </div>`).join('') || `<p class="topbar-sub" style="margin-bottom:8px;">No custom ${entity} fields yet.</p>`;

  listEl.querySelectorAll('[data-cf-label]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(inp.dataset.cfLabel.split(':')[1]);
      DATA.customFieldDefs[entity][i].label = inp.value;
      saveData(DATA); renderSettings();
    });
  });
  listEl.querySelectorAll('[data-cf-type]').forEach(sel=>{
    sel.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(sel.dataset.cfType.split(':')[1]);
      DATA.customFieldDefs[entity][i].type = sel.value;
      saveData(DATA); renderSettings();
    });
  });
  listEl.querySelectorAll('[data-cf-options]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(inp.dataset.cfOptions.split(':')[1]);
      DATA.customFieldDefs[entity][i].options = inp.value.split(',').map(s=>s.trim()).filter(Boolean);
      saveData(DATA); renderSettings();
    });
  });
  listEl.querySelectorAll('[data-cf-remove]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!requireSubscriptionForAction()) return;
      const i = Number(btn.dataset.cfRemove.split(':')[1]);
      DATA.customFieldDefs[entity].splice(i,1);
      saveData(DATA); renderSettings();
    });
  });
}
document.getElementById('addContactFieldBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.customFieldDefs.contact.push({id:uid('cf'), label:'New field', type:'text', options:[]});
  saveData(DATA); renderSettings();
});
document.getElementById('addDealFieldBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.customFieldDefs.deal.push({id:uid('cf'), label:'New field', type:'text', options:[]});
  saveData(DATA); renderSettings();
});

document.getElementById('saveSettingsBtn').addEventListener('click',()=>{
  if(!requireSubscriptionForAction()) return;
  DATA.settings.workspaceName = document.getElementById('settingsWorkspaceName').value || 'Alba Business Desk';
  saveData(DATA);
  document.title = DATA.settings.workspaceName;
});

/* Connect buttons — full-page redirect into each platform's OAuth consent
   screen. Facebook and Instagram are genuinely separate logins now — Meta
   retired Instagram-via-Facebook-Login access in January 2025, so each
   platform has its own connect flow and its own connection record.
   No secret or base URL needed — being signed into the CRM IS the
   authorization now, checked server-side via the session cookie. */
/* Each platform button is a single toggle: it connects when disconnected,
   and disconnects when connected. One control per platform reads far more
   clearly than a connect button plus a separate disconnect button. */
const SOCIAL_BUTTONS = [
  { key:'meta',      btn:'connectFacebookBtn',  label:'connectFacebookBtnLabel',  name:'Facebook',  connectPath:'/api/oauth-meta' },
  { key:'instagram', btn:'connectInstagramBtn', label:'connectInstagramBtnLabel', name:'Instagram', connectPath:'/api/oauth-instagram' },
  { key:'tiktok',    btn:'connectTiktokBtn',    label:'connectTiktokBtnLabel',    name:'TikTok',    connectPath:'/api/oauth-tiktok' }
];
const socialConnected = { meta:false, instagram:false, tiktok:false };

SOCIAL_BUTTONS.forEach(cfg=>{
  document.getElementById(cfg.btn).addEventListener('click', async ()=>{
    if(!requireSubscriptionForAction()) return;
    if(!socialConnected[cfg.key]){
      window.location.href = `${BACKEND_BASE}${cfg.connectPath}`;
      return;
    }
    const extra = cfg.key === 'instagram'
      ? ' Instagram has no automatic revoke, so also remove Alba Business Desk from Instagram\'s own app settings if you want the permission cleared on their side too.'
      : '';
    if(!(await showConfirm(`Disconnect ${cfg.name}? Its stats will stop syncing. Data already pulled into your workspace stays.${extra}`,
      { title:`Disconnect ${cfg.name}`, confirmLabel:'Disconnect', danger:true }))) return;
    const btn = document.getElementById(cfg.btn);
    btn.disabled = true;
    try{
      const res = await fetch(`${BACKEND_BASE}/api/social-sync?action=disconnect&platform=${cfg.key}`, {
        method:'POST', credentials:'include',
        headers:{ 'X-CSRF-Token': getCsrfToken() }
      });
      const data = await res.json();
      if(!res.ok) await showAlert(data.error || `Could not disconnect ${cfg.name}.`);
    }catch(err){
      await showAlert('Could not reach the backend.');
    }
    btn.disabled = false;
    refreshConnectionStatus();
  });
});
document.getElementById('refreshConnectionStatusBtn').addEventListener('click', refreshConnectionStatus);

function setSocialButtonState(cfg, connected, detail){
  socialConnected[cfg.key] = connected;
  const labelEl = document.getElementById(cfg.label);
  if(labelEl) labelEl.textContent = connected ? `Disconnect ${cfg.name}` : `Continue with ${cfg.name}`;
  const btn = document.getElementById(cfg.btn);
  if(btn) btn.title = connected && detail ? `Connected as ${detail}` : '';
}

async function refreshConnectionStatus(){
  const el = document.getElementById('connectionStatusList');
  el.innerHTML = '<p class="topbar-sub">Checking…</p>';
  try{
    const res = await fetch(`${BACKEND_BASE}/api/social-sync?action=status`, { credentials:'include' });
    const data = await res.json();
    const details = {
      meta: (data.meta && data.meta.pageName) || '',
      instagram: (data.instagram && data.instagram.username) ? '@'+data.instagram.username : '',
      tiktok: (data.tiktok && data.tiktok.displayName) || ''
    };
    const rows = SOCIAL_BUTTONS.map(cfg=>{
      const connected = !!(data[cfg.key] && data[cfg.key].connected);
      setSocialButtonState(cfg, connected, details[cfg.key]);
      return connected
        ? `<div class="info-row"><span>${cfg.name}</span><span style="color:var(--accent);">Connected${details[cfg.key]?' — '+escapeHtml(details[cfg.key]):''}</span></div>`
        : `<div class="info-row"><span>${cfg.name}</span><span style="color:var(--graphite);">Not connected</span></div>`;
    });
    el.innerHTML = rows.join('') + (data.note ? `<p class="topbar-sub" style="margin-top:8px;">${escapeHtml(data.note)}</p>` : '');
  }catch(err){
    el.innerHTML = '<p class="topbar-sub">Could not reach the backend right now.</p>';
  }
}

/* If we've just been redirected back from a Connect flow, show the result */
(function handleSocialConnectRedirect(){
  const params = new URLSearchParams(window.location.search);
  const result = params.get('social_connect');
  if(!result) return;
  const messages = {
    meta_success: 'Facebook connected successfully.',
    meta_denied: 'Facebook connection was cancelled.',
    meta_error: 'Something went wrong connecting Facebook — check the backend logs.',
    instagram_success: 'Instagram connected successfully.',
    instagram_denied: 'Instagram connection was cancelled.',
    instagram_error: 'Something went wrong connecting Instagram — check the backend logs.',
    tiktok_success: 'TikTok connected successfully.',
    tiktok_denied: 'TikTok connection was cancelled.',
    tiktok_error: 'Something went wrong connecting TikTok — check the backend logs.',
    gcal_success: 'Google Calendar connected successfully.',
    gcal_denied: 'Google Calendar connection was cancelled.',
    gcal_error: 'Something went wrong connecting Google Calendar — check the backend logs.'
  };
  if(messages[result]) showAlert(messages[result]);
  params.delete('social_connect');
  const newUrl = window.location.pathname + (params.toString() ? '?'+params.toString() : '');
  window.history.replaceState({}, '', newUrl);
})();
document.getElementById('exportDataBtn').addEventListener('click',()=>{
  const blob = new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crm-export.json';
  a.click();
});
document.getElementById('resetDataBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('This replaces all current data with the sample dataset. Continue?', { title:'Reset to sample data', confirmLabel:'Reset', danger:true }))) return;
  DATA = defaultData();
  saveData(DATA);
  renderAll();
});

/* JSON import: expects the same shape as our own export */
/* Validates a file's extension, MIME type (when the browser provides one),
   and size before we ever try to read its contents — rejects anything that
   doesn't look like what it claims to be. */
function validateImportFile(file, { extensions, mimeTypes, maxSizeMB = 15 }){
  const name = (file.name || '').toLowerCase();
  const hasValidExtension = extensions.some(ext => name.endsWith(ext));
  if(!hasValidExtension){
    return `That file doesn't look like a ${extensions.join(' or ')} file (based on its name). Please choose a ${extensions.join('/')} file.`;
  }
  if(file.type && mimeTypes.length && !mimeTypes.includes(file.type)){
    return `That file's type (${file.type}) doesn't match what was expected. Please choose a genuine ${extensions.join('/')} file.`;
  }
  if(file.size > maxSizeMB * 1024 * 1024){
    return `That file is too large (${(file.size/1024/1024).toFixed(1)}MB) — the limit is ${maxSizeMB}MB.`;
  }
  if(file.size === 0){
    return 'That file is empty.';
  }
  return null; // no error — looks good
}

document.getElementById('importDataBtn').addEventListener('click',()=>{
  document.getElementById('importDataFile').click();
});
document.getElementById('importDataFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  if(!file) return;
  if(!requireSubscriptionForAction()){ e.target.value=''; return; }
  const validationError = validateImportFile(file, { extensions:['.json'], mimeTypes:['application/json','text/json',''] });
  if(validationError){ await showAlert(validationError); e.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = async evt=>{
    try{
      const parsed = JSON.parse(evt.target.result);
      const requiredKeys = ['contacts','deals','tasks','settings','stages'];
      const looksValid = requiredKeys.every(k=>k in parsed);
      if(!looksValid){ await showAlert('That file doesn\'t look like an Alba Business Desk export — missing expected fields.'); return; }
      if(!(await showConfirm('This will replace all current data with the contents of this file. Continue?', { title:'Import data', confirmLabel:'Import', danger:true }))) return;
      parsed.activity = parsed.activity || [];
      DATA = migrateData(parsed);
      saveData(DATA);
      renderAll();
    }catch(err){
      await showAlert('Could not read that file as JSON.');
    }
    e.target.value = '';
  };
  reader.onerror = async ()=>{ await showAlert('Could not read that file.'); e.target.value=''; };
  reader.readAsText(file);
});

/* CSV export/import for contacts */
function csvEscape(v){
  const s = String(v===undefined||v===null?'':v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function parseCsv(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i], next = text[i+1];
    if(inQuotes){
      if(ch==='"' && next==='"'){ field+='"'; i++; }
      else if(ch==='"'){ inQuotes=false; }
      else field += ch;
    } else {
      if(ch==='"') inQuotes = true;
      else if(ch===','){ row.push(field); field=''; }
      else if(ch==='\n' || ch==='\r'){
        if(field!=='' || row.length){ row.push(field); rows.push(row); row=[]; field=''; }
        if(ch==='\r' && next==='\n') i++;
      } else field += ch;
    }
  }
  if(field!=='' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r=>r.length && r.some(c=>c.trim()!==''));
}
document.getElementById('exportContactsCsvBtn').addEventListener('click',()=>{
  const header = ['Name','Company','Email','Phone','Tag','Notes'];
  const rows = DATA.contacts.map(c=>[c.name,c.company,c.email,c.phone,c.tag,c.notes].map(csvEscape).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'contacts-export.csv';
  a.click();
});
document.getElementById('importContactsCsvBtn').addEventListener('click',()=>{
  document.getElementById('importContactsCsvFile').click();
});
document.getElementById('importContactsCsvFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  if(!file) return;
  if(!requireSubscriptionForAction()){ e.target.value=''; return; }
  const validationError = validateImportFile(file, { extensions:['.csv'], mimeTypes:['text/csv','application/vnd.ms-excel','text/plain',''] });
  if(validationError){ await showAlert(validationError); e.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = async evt=>{
    const rows = parseCsv(evt.target.result);
    if(!rows.length){ await showAlert('That CSV looks empty.'); return; }
    const header = rows[0].map(h=>h.trim().toLowerCase());
    const idx = { name: header.indexOf('name'), company: header.indexOf('company'), email: header.indexOf('email'), phone: header.indexOf('phone'), tag: header.indexOf('tag'), notes: header.indexOf('notes') };
    if(idx.name===-1){ await showAlert('The CSV needs at least a "Name" column.'); return; }
    const existingEmails = new Set(DATA.contacts.map(c=>(c.email||'').toLowerCase()).filter(Boolean));
    let added = 0, skipped = 0;
    for(let i=1;i<rows.length;i++){
      const r = rows[i];
      const name = (r[idx.name]||'').trim();
      if(!name) continue;
      const email = idx.email>-1 ? (r[idx.email]||'').trim() : '';
      if(email && existingEmails.has(email.toLowerCase())){ skipped++; continue; }
      DATA.contacts.push({
        id:uid('c'), name,
        company: idx.company>-1 ? (r[idx.company]||'').trim() : '',
        email, phone: idx.phone>-1 ? (r[idx.phone]||'').trim() : '',
        tag: idx.tag>-1 && r[idx.tag] ? r[idx.tag].trim() : 'Lead',
        notes: idx.notes>-1 ? (r[idx.notes]||'').trim() : '',
        createdAt: Date.now()
      });
      if(email) existingEmails.add(email.toLowerCase());
      added++;
    }
    logActivity(`Imported ${added} contact${added===1?'':'s'} from CSV${skipped?` (${skipped} duplicate${skipped===1?'':'s'} skipped)`:''}`);
    saveData(DATA); renderAll();
    await showAlert(`Imported ${added} contact${added===1?'':'s'}.${skipped?` Skipped ${skipped} duplicate email${skipped===1?'':'s'}.`:''}`);
    e.target.value = '';
  };
  reader.readAsText(file);
});
