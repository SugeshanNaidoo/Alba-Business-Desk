// Contacts tab: the contacts list/table, companies, the add/edit modal, and the detail drawer.

/* ---------- Render: Contacts ---------- */
function contactGroups(){
  return [
    {key:'all', label:'All contacts', tags:null},
    {key:'potential', label:'Potential clients', tags: DATA.contactStatuses.filter(s=>s.category==='potential').map(s=>s.name)},
    {key:'clients', label:'Current & past clients', tags: DATA.contactStatuses.filter(s=>s.category==='client').map(s=>s.name)},
    {key:'other', label:'Other', tags: DATA.contactStatuses.filter(s=>s.category==='other').map(s=>s.name)}
  ];
}
let contactGroup = 'all';
let contactTag = 'all';

function tagClass(tag){
  const status = DATA.contactStatuses.find(s=>s.name===tag);
  if(!status) return 'tag-other';
  if(status.category==='potential') return 'tag-lead';
  if(status.category==='client') return '';
  return 'tag-other';
}
function contactsInGroup(groupKey){
  const g = contactGroups().find(x=>x.key===groupKey);
  if(!g || !g.tags) return DATA.contacts;
  return DATA.contacts.filter(c=>g.tags.includes(c.tag));
}

function renderContacts(){
  // Primary grouping — the main way to tell potential clients apart from current & past clients
  document.getElementById('contactGroups').innerHTML = contactGroups().map(g=>{
    const count = contactsInGroup(g.key).length;
    return `<span class="chip ${g.key===contactGroup?'active':''}" data-group="${g.key}">${g.label} (${count})</span>`;
  }).join('');
  document.querySelectorAll('#contactGroups .chip').forEach(el=>{
    el.addEventListener('click',()=>{ contactGroup=el.dataset.group; contactTag='all'; renderContacts(); });
  });

  // Secondary tag filter, scoped to whatever's in the selected group
  const groupContacts = contactsInGroup(contactGroup);
  const tagsHere = [...new Set(groupContacts.map(c=>c.tag))];
  if(tagsHere.length > 1){
    document.getElementById('contactFilters').innerHTML = ['all',...tagsHere].map(t=>
      `<span class="chip ${t===contactTag?'active':''}" data-tag="${t}">${t==='all'?'All statuses':t}</span>`).join('');
    document.querySelectorAll('#contactFilters .chip').forEach(el=>{
      el.addEventListener('click',()=>{contactTag=el.dataset.tag; renderContacts();});
    });
  } else {
    document.getElementById('contactFilters').innerHTML = '';
  }

  const search = document.getElementById('globalSearch').value.toLowerCase();
  let list = groupContacts.filter(c=> contactTag==='all' || c.tag===contactTag);
  if(search) list = list.filter(c=>(c.name+c.company+c.email).toLowerCase().includes(search));
  list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));

  const tbody = document.getElementById('contactsTbody');
  document.getElementById('contactsEmpty').style.display = list.length ? 'none':'block';
  tbody.innerHTML = list.map(c=>{
    return `<tr data-contact="${c.id}">
      <td><div style="display:flex;align-items:center;"><span class="avatar">${initials(c.name)}</span><div class="name-cell">${escapeHtml(c.name)}</div></div></td>
      <td>${escapeHtml(c.email||'—')}</td>
      <td>${escapeHtml(c.phone||'—')}</td>
      <td><span class="tag ${tagClass(c.tag)}">${c.tag}</span></td>
      <td>${escapeHtml((companyById(c.companyId)||{}).name || c.company || '—')}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click',()=>openDrawer(tr.dataset.contact));
  });
  renderCompanies();
}
document.querySelectorAll('#contactsSubNav .chip').forEach(el=>{
  el.addEventListener('click',()=>{
    document.querySelectorAll('#contactsSubNav .chip').forEach(c=>c.classList.remove('active'));
    el.classList.add('active');
    const isPeople = el.dataset.subview==='people';
    document.getElementById('contactsPeoplePane').style.display = isPeople ? 'block' : 'none';
    document.getElementById('contactsCompaniesPane').style.display = isPeople ? 'none' : 'block';
    if(!isPeople) renderCompanies();
  });
});

function renderCompanies(){
  const list = DATA.companies.slice().sort((a,b)=>a.name.localeCompare(b.name));
  document.getElementById('companiesSummary').textContent = `${list.length} compan${list.length===1?'y':'ies'}`;
  const tbody = document.getElementById('companiesTbody');
  document.getElementById('companiesEmpty').style.display = list.length ? 'none' : 'block';
  tbody.innerHTML = list.map(co=>{
    const contactCount = DATA.contacts.filter(c=>c.companyId===co.id).length;
    return `<tr data-company="${co.id}">
      <td class="name-cell">${escapeHtml(co.name)}</td>
      <td>${escapeHtml(co.industry||'—')}</td>
      <td>${escapeHtml(co.website||'—')}</td>
      <td>${contactCount}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click',()=>openCompanyModal(tr.dataset.company));
  });
}

let editingCompanyId = null;
function openCompanyModal(id){
  editingCompanyId = id || null;
  const co = id ? companyById(id) : null;
  document.getElementById('companyModalTitle').textContent = co ? 'Edit company' : 'Add company';
  document.getElementById('coName').value = co ? co.name : '';
  document.getElementById('coIndustry').value = co ? co.industry : '';
  document.getElementById('coWebsite').value = co ? co.website : '';
  document.getElementById('coNotes').value = co ? co.notes : '';
  const linked = co ? DATA.contacts.filter(c=>c.companyId===co.id) : [];
  document.getElementById('companyContactsList').innerHTML = co ? `
    <div class="sub-cell" style="font-weight:600;margin:10px 0 6px 0;">Linked contacts (${linked.length})</div>
    ${linked.length ? linked.map(c=>`<div class="info-row"><span>${escapeHtml(c.name)}</span><span>${escapeHtml(c.email||'')}</span></div>`).join('') : "<p class=\"topbar-sub\">No contacts linked yet — set this company from a contact's edit form.</p>"}
  ` : '';
  document.getElementById('deleteCompanyBtn').style.display = co ? 'inline-flex' : 'none';
  document.getElementById('companyModalOverlay').classList.add('active');
}
document.getElementById('addCompanyBtn').addEventListener('click',()=>openCompanyModal(null));
document.getElementById('saveCompanyBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('coName').value.trim();
  if(!name){ await showAlert('Please enter a company name.'); return; }
  const payload = {
    name,
    industry: document.getElementById('coIndustry').value.trim(),
    website: document.getElementById('coWebsite').value.trim(),
    notes: document.getElementById('coNotes').value.trim()
  };
  if(editingCompanyId){
    Object.assign(companyById(editingCompanyId), payload);
    logActivity(`Updated company ${name}`);
  } else {
    DATA.companies.push({id:uid('co'), createdAt:Date.now(), ...payload});
    logActivity(`Added company ${name}`);
  }
  saveData(DATA); closeModals(); renderCompanies(); renderContacts();
});
document.getElementById('deleteCompanyBtn').addEventListener('click', async ()=>{
  if(!(await showConfirm('Delete this company? Linked contacts keep their own record but lose the company link.', { title:'Delete company', confirmLabel:'Delete', danger:true }))) return;
  DATA.companies = DATA.companies.filter(co=>co.id!==editingCompanyId);
  DATA.contacts.forEach(c=>{ if(c.companyId===editingCompanyId) c.companyId=null; });
  saveData(DATA); closeModals(); renderCompanies(); renderContacts();
});



/* ---------- Modals: Contact ---------- */
let editingContactId = null;
function renderCustomFieldsForm(container, entity, values){
  values = values || {};
  const defs = DATA.customFieldDefs[entity];
  if(!defs.length){ container.innerHTML = ''; return; }
  container.innerHTML = `<div class="sub-cell" style="font-weight:600;margin:6px 0;">Additional details</div>` + defs.map(f=>{
    const val = values[f.id] !== undefined ? values[f.id] : '';
    if(f.type==='select'){
      const opts = (f.options||[]).map(o=>`<option value="${escapeHtml(o)}" ${val===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
      return `<div class="field"><label>${escapeHtml(f.label)}</label><select data-cf-field="${f.id}"><option value="">Not set</option>${opts}</select></div>`;
    }
    const type = f.type==='number' ? 'number' : (f.type==='date' ? 'date' : 'text');
    return `<div class="field"><label>${escapeHtml(f.label)}</label><input type="${type}" data-cf-field="${f.id}" value="${escapeHtml(val)}"></div>`;
  }).join('');
}
function collectCustomFieldValues(container){
  const result = {};
  container.querySelectorAll('[data-cf-field]').forEach(el=>{
    if(el.value !== '') result[el.dataset.cfField] = el.value;
  });
  return result;
}

function openContactModal(id){
  editingContactId = id || null;
  const c = id ? contactById(id) : null;
  document.getElementById('contactModalTitle').textContent = c ? 'Edit contact' : 'Add contact';
  document.getElementById('cName').value = c ? c.name : '';
  document.getElementById('cCompany').value = c ? c.company : '';
  document.getElementById('cEmail').value = c ? c.email : '';
  document.getElementById('cPhone').value = c ? c.phone : '';
  document.getElementById('cTag').innerHTML = DATA.contactStatuses.map(s=>`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('cTag').value = c ? c.tag : (DATA.contactStatuses[0] ? DATA.contactStatuses[0].name : '');
  document.getElementById('cSource').innerHTML = '<option value="">Not set</option>' + DATA.leadSources.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('cSource').value = c ? (c.source||'') : '';
  document.getElementById('cCompanyLink').innerHTML = '<option value="">None</option>' + DATA.companies.map(co=>`<option value="${co.id}">${escapeHtml(co.name)}</option>`).join('');
  document.getElementById('cCompanyLink').value = c ? (c.companyId||'') : '';
  document.getElementById('cNotes').innerHTML = c ? sanitizeHtml(c.notes) : '';
  renderCustomFieldsForm(document.getElementById('cCustomFieldsContainer'), 'contact', c ? c.customFields : {});
  document.getElementById('deleteContactBtn').style.display = c ? 'inline-flex' : 'none';
  document.getElementById('contactModalOverlay').classList.add('active');
}
document.getElementById('addContactBtn').addEventListener('click',()=>openContactModal(null));
document.getElementById('saveContactBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('cName').value.trim();
  if(!name){ await showAlert('Please enter a name.'); return; }
  const notesHtml = sanitizeHtml(document.getElementById('cNotes').innerHTML);
  const customFields = collectCustomFieldValues(document.getElementById('cCustomFieldsContainer'));
  const companyId = document.getElementById('cCompanyLink').value || null;
  const source = document.getElementById('cSource').value || '';
  if(editingContactId){
    const c = contactById(editingContactId);
    c.name=name; c.company=document.getElementById('cCompany').value;
    c.email=document.getElementById('cEmail').value; c.phone=document.getElementById('cPhone').value;
    c.tag=document.getElementById('cTag').value; c.notes=notesHtml;
    c.companyId=companyId; c.source=source; c.customFields=customFields;
    logActivity(`Updated contact ${name}`);
  } else {
    DATA.contacts.push({id:uid('c'),name,company:document.getElementById('cCompany').value,
      email:document.getElementById('cEmail').value, phone:document.getElementById('cPhone').value,
      tag:document.getElementById('cTag').value, notes:notesHtml,
      companyId, source, customFields, createdAt:Date.now()});
    logActivity(`Added contact ${name}`);
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deleteContactBtn').addEventListener('click', async ()=>{
  if(!(await showConfirm('Delete this contact? Related deals will keep the deal but lose the contact link.', { title:'Delete contact', confirmLabel:'Delete', danger:true }))) return;
  DATA.contacts = DATA.contacts.filter(c=>c.id!==editingContactId);
  saveData(DATA); closeModals(); closeDrawer(); renderAll();
});



/* ---------- Drawer ---------- */
let drawerContactId = null;
function renderContactActivityTimeline(contactId){
  const list = activityFor('contact', contactId);
  document.getElementById('drawerActivity').innerHTML = list.length ? list.map(a=>`
    <div class="activity-row"><div class="activity-dot"></div>
      <div><div class="activity-text"><strong>${a.type}:</strong> ${escapeHtml(a.text)}</div><div class="activity-time">${timeAgo(a.timestamp)}</div></div>
    </div>`).join('') : '<p class="topbar-sub" style="padding:6px 0;">No activity logged yet.</p>';
}
function openDrawer(contactId){
  const c = contactById(contactId);
  if(!c) return;
  drawerContactId = contactId;
  document.getElementById('drawerName').textContent = c.name;
  document.getElementById('drawerCompany').textContent = c.company || '';
  document.getElementById('drawerEmail').textContent = c.email || '—';
  document.getElementById('drawerPhone').textContent = c.phone || '—';
  document.getElementById('drawerTag').innerHTML = `<span class="tag ${tagClass(c.tag)}">${c.tag}</span>`;
  document.getElementById('drawerNotes').innerHTML = c.notes ? sanitizeHtml(c.notes) : '<span class="topbar-sub">No notes yet.</span>';
  const deals = DATA.deals.filter(d=>d.contactId===c.id);
  document.getElementById('drawerDeals').innerHTML = deals.length ? deals.map(d=>`
    <div class="info-row"><span>${escapeHtml(d.title)} <span class="topbar-sub" style="font-size:11px;">(${d.stage})</span></span><span>${fmtMoney(d.value)}</span></div>
  `).join('') : '<p class="topbar-sub">No deals yet.</p>';
  renderContactActivityTimeline(contactId);
  document.getElementById('drawerEditBtn').onclick = ()=>{ closeDrawer(); openContactModal(c.id); };
  document.getElementById('contactDrawer').classList.add('active');
  document.getElementById('drawerOverlay').classList.add('active');
}
document.getElementById('contactLogAddBtn').addEventListener('click',()=>{
  if(!drawerContactId) return;
  const text = document.getElementById('contactLogText').value.trim();
  if(!text) return;
  const type = document.getElementById('contactLogType').value;
  logActivity(text, {type, relatedType:'contact', relatedId:drawerContactId});
  saveData(DATA);
  document.getElementById('contactLogText').value = '';
  renderContactActivityTimeline(drawerContactId);
  renderDashboard();
});
function closeDrawer(){
  document.getElementById('contactDrawer').classList.remove('active');
  document.getElementById('drawerOverlay').classList.remove('active');
}
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

