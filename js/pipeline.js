// Pipeline tab: the Kanban board and the deal add/edit modal.

/* ---------- Render: Deals / Kanban ---------- */
function renderBoard(){
  const board = document.getElementById('board');
  const total = DATA.deals.filter(d=>d.stage!=='Lost').reduce((s,d)=>s+Number(d.value||0),0);
  document.getElementById('pipelineSummary').textContent = `${DATA.deals.length} deals · ${fmtMoney(total)} total`;

  board.innerHTML = DATA.stages.map(stage=>{
    const deals = DATA.deals.filter(d=>d.stage===stage);
    const stageTotal = deals.reduce((s,d)=>s+Number(d.value||0),0);
    const cls = stage==='Won'?'stage-won':(stage==='Lost'?'stage-lost':'');
    return `<div class="col" data-stage="${stage}">
      <div class="col-head"><span class="col-title">${stage}</span><span class="col-count">${deals.length}</span></div>
      <div class="col-total">${fmtMoney(stageTotal)}</div>
      <div class="col-drop" data-drop="${stage}">
        ${deals.map(d=>{
          const c = contactById(d.contactId);
          const member = d.assignedTo ? DATA.teamMembers.find(m=>m.id===d.assignedTo) : null;
          const idleDays = Math.floor((Date.now() - (d.lastActivityAt||d.createdAt)) / 86400000);
          const isStale = idleDays >= 14 && stage!=='Won' && stage!=='Lost';
          return `<div class="deal-card ${cls}" draggable="true" data-deal="${d.id}">
            <div class="deal-title">${escapeHtml(d.title)}</div>
            <div class="deal-contact">${c?escapeHtml(c.name):'No contact'}</div>
            ${isStale ? `<div class="stale-flag">⚠ No activity in ${idleDays}d</div>` : ''}
            <div class="deal-foot">
              <span class="deal-value">${fmtMoney(d.value)}</span>
              <span style="display:flex;align-items:center;gap:6px;">
                ${member ? `<span class="prob-pill" title="${escapeHtml(member.name)}">${escapeHtml(initials(member.name))}</span>` : ''}
                ${d.probability!==undefined ? `<span class="prob-pill">${d.probability}%</span>` : ''}
                <span class="priority-dot priority-${d.priority}"></span>
              </span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  board.querySelectorAll('.deal-card').forEach(card=>{
    card.addEventListener('click',()=>openDealModal(card.dataset.deal));
    card.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain', card.dataset.deal); });
  });
  board.querySelectorAll('.col-drop').forEach(zone=>{
    zone.addEventListener('dragover',e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{
      e.preventDefault(); zone.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const deal = dealById(id);
      if(deal && deal.stage !== zone.dataset.drop){
        if(!requireSubscriptionForAction()) return;
        const newStage = zone.dataset.drop;
        recordStageChange(deal, newStage);
        deal.probability = suggestedProbability(newStage);
        logActivity(`Moved "${deal.title}" to ${newStage}`);
        saveData(DATA); renderAll();
        if(newStage==='Lost' && !deal.lostReason){
          openDealModal(deal.id); // prompt to record why, while it's top of mind
        }
      }
    });
  });
}



/* ---------- Modals: Deal ---------- */
let editingDealId = null;
function refreshDealSelects(){
  const contactSel = document.getElementById('dContact');
  contactSel.innerHTML = DATA.contacts.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const stageSel = document.getElementById('dStage');
  stageSel.innerHTML = DATA.stages.map(s=>`<option value="${s}">${s}</option>`).join('');
  document.getElementById('dAssignedTo').innerHTML = '<option value="">Unassigned</option>' +
    DATA.teamMembers.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  document.getElementById('dLostReason').innerHTML = '<option value="">Not set</option>' +
    DATA.lostReasons.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
}
function recordStageChange(deal, newStage){
  if(deal.stage === newStage) return;
  deal.stage = newStage;
  deal.stageHistory = deal.stageHistory || [];
  deal.stageHistory.push({stage:newStage, enteredAt:Date.now()});
  deal.lastActivityAt = Date.now();
  if(newStage !== 'Lost') deal.lostReason = null;
}
function suggestedProbability(stage){
  if(stage==='Won') return 100;
  if(stage==='Lost') return 0;
  const openStages = DATA.stages.filter(s=>s!=='Won'&&s!=='Lost');
  const idx = openStages.indexOf(stage);
  if(idx<0) return 50;
  return Math.round(((idx+1)/(openStages.length+1))*100);
}
function renderDealActivityTimeline(dealId){
  const list = activityFor('deal', dealId);
  document.getElementById('dealActivityTimeline').innerHTML = list.length ? list.map(a=>`
    <div class="activity-row"><div class="activity-dot"></div>
      <div><div class="activity-text"><strong>${escapeHtml(a.type||"Note")}:</strong> ${escapeHtml(activityText(a))}</div><div class="activity-time">${timeAgo(activityTime(a))}</div></div>
    </div>`).join('') : '<p class="topbar-sub" style="padding:8px 0;">No activity logged yet.</p>';
}
function openDealModal(id, presetStage){
  editingDealId = id || null;
  refreshDealSelects();
  const d = id ? dealById(id) : null;
  document.getElementById('dealModalTitle').textContent = d ? 'Edit deal' : 'Add deal';
  document.getElementById('dTitle').value = d ? d.title : '';
  document.getElementById('dContact').value = d ? d.contactId : (DATA.contacts[0]?DATA.contacts[0].id:'');
  document.getElementById('dValue').value = d ? d.value : '';
  document.getElementById('dStage').value = d ? d.stage : (presetStage || DATA.stages[0]);
  document.getElementById('dClose').value = d ? d.closeDate : '';
  document.getElementById('dPriority').value = d ? d.priority : 'medium';
  document.getElementById('dAssignedTo').value = d ? (d.assignedTo||'') : '';
  document.getElementById('dLostReason').value = d ? (d.lostReason||'') : '';
  document.getElementById('dLostReasonWrap').style.display = (document.getElementById('dStage').value==='Lost') ? 'block' : 'none';
  const prob = d ? (d.probability!==undefined ? d.probability : suggestedProbability(d.stage)) : suggestedProbability(presetStage||DATA.stages[0]);
  document.getElementById('dProbability').value = prob;
  document.getElementById('dProbabilityValue').textContent = prob+'%';
  document.getElementById('deleteDealBtn').style.display = d ? 'inline-flex' : 'none';
  document.getElementById('dealActivitySection').style.display = d ? 'block' : 'none';
  renderCustomFieldsForm(document.getElementById('dCustomFieldsContainer'), 'deal', d ? d.customFields : {});
  if(d){
    renderDealActivityTimeline(d.id);
    // The feed holds only a recent page — fetch this deal's own history.
    if(typeof loadActivityFor === 'function'){
      loadActivityFor('deal', d.id).then(added => { if(added) renderDealActivityTimeline(d.id); });
    }
  }
  document.getElementById('dealModalOverlay').classList.add('active');
}
document.getElementById('dProbability').addEventListener('input', e=>{
  document.getElementById('dProbabilityValue').textContent = e.target.value+'%';
});
document.getElementById('dStage').addEventListener('change', e=>{
  document.getElementById('dLostReasonWrap').style.display = (e.target.value==='Lost') ? 'block' : 'none';
  if(!editingDealId){ // only auto-suggest for new deals
    const p = suggestedProbability(e.target.value);
    document.getElementById('dProbability').value = p;
    document.getElementById('dProbabilityValue').textContent = p+'%';
  }
});
document.getElementById('dealLogAddBtn').addEventListener('click',()=>{
  if(!editingDealId) return;
  if(!requireSubscriptionForAction()) return;
  const text = document.getElementById('dealLogText').value.trim();
  if(!text) return;
  const type = document.getElementById('dealLogType').value;
  logActivity(text, {type, relatedType:'deal', relatedId:editingDealId});
  const deal = dealById(editingDealId);
  if(deal) deal.lastActivityAt = Date.now();
  saveData(DATA);
  document.getElementById('dealLogText').value = '';
  renderDealActivityTimeline(editingDealId);
  renderDashboard();
});
document.getElementById('addDealBtn').addEventListener('click',()=>openDealModal(null));
document.getElementById('saveDealBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  const title = document.getElementById('dTitle').value.trim();
  if(!title){ await showAlert('Please enter a deal title.'); return; }
  const newStage = document.getElementById('dStage').value;
  if(newStage==='Lost' && !document.getElementById('dLostReason').value){
    if(!(await showConfirm('No lost reason selected — save anyway? Setting one helps the Reports view break down why deals are lost.', { title:'Save without a lost reason?', confirmLabel:'Save anyway' }))) return;
  }
  const payload = {
    title, contactId: document.getElementById('dContact').value,
    value: Number(document.getElementById('dValue').value)||0,
    closeDate: document.getElementById('dClose').value,
    priority: document.getElementById('dPriority').value,
    probability: Number(document.getElementById('dProbability').value),
    assignedTo: document.getElementById('dAssignedTo').value || null,
    lostReason: newStage==='Lost' ? (document.getElementById('dLostReason').value || null) : null,
    customFields: collectCustomFieldValues(document.getElementById('dCustomFieldsContainer'))
  };
  if(editingDealId){
    const existing = dealById(editingDealId);
    Object.assign(existing, payload);
    recordStageChange(existing, newStage);
    logActivity(`Updated deal "${title}"`);
  } else {
    const deal = {id:uid('d'), createdAt:Date.now(), lastActivityAt:Date.now(), stage:newStage,
      stageHistory:[{stage:newStage, enteredAt:Date.now()}], ...payload};
    DATA.deals.push(deal);
    logActivity(`Added deal "${title}"`);
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deleteDealBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  if(!(await showConfirm('Delete this deal?', { title:'Delete deal', confirmLabel:'Delete', danger:true }))) return;
  DATA.deals = DATA.deals.filter(d=>d.id!==editingDealId);
  saveData(DATA); closeModals(); renderAll();
});

