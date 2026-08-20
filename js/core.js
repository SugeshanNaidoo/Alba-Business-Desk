// Shared foundation used by every section: the data model, storage,
// navigation, search, theming, and small utilities. Loaded before all
// section files, since they all depend on this.

/* ---------- Storage ---------- */
// Where the backend (social sync, OAuth, billing) lives. Left empty on
// purpose: this assumes the backend is deployed in the same Vercel project
// as this file, so relative paths like '/api/billing' just work with no
// configuration needed. If you ever deploy the backend on a DIFFERENT
// domain than this CRM, set this to that domain instead, e.g.
// 'https://your-backend.vercel.app' (no trailing slash).
const BACKEND_BASE = '';

const DB_KEY = 'albabusinessdesk_crm_data_v1';
const LEGACY_DB_KEY = 'flowline_crm_data_v1';       // pre-rename local cache
const THEME_KEY = 'albabusinessdesk_theme';
const LEGACY_THEME_KEY = 'flowline_theme';          // pre-rename theme key

/* Firestore collection holding the legacy monolithic workspace document.
   Both names exist because renaming a collection does not move data — the
   backend copies each user forward on bootstrap, and the client falls back
   to the old name if that copy has not happened yet. */
const WORKSPACE_COLLECTION = 'albabusinessdesk_crm_users';
const LEGACY_WORKSPACE_COLLECTION = 'flowline_crm_users';

/* One-time local cache migration. Losing localStorage is survivable (the
   cloud copy is authoritative), but carrying it across avoids a pointless
   full re-sync and a flash of default data on first load after the rename. */
(function migrateLocalKeys(){
  try{
    if(!localStorage.getItem(DB_KEY)){
      const old = localStorage.getItem(LEGACY_DB_KEY);
      if(old) localStorage.setItem(DB_KEY, old);
    }
    if(!localStorage.getItem(THEME_KEY)){
      const oldTheme = localStorage.getItem(LEGACY_THEME_KEY);
      if(oldTheme) localStorage.setItem(THEME_KEY, oldTheme);
    }
  }catch(e){ /* private browsing — non-fatal */ }
})();

/* ---------- Dialogs (replace native alert/confirm/prompt) ---------- */
let _dialogResolve = null;
function _closeDialog(result){
  document.getElementById('dialogOverlay').classList.remove('active');
  if(_dialogResolve){ const r = _dialogResolve; _dialogResolve = null; r(result); }
}
function showAlert(message, { title = 'Notice' } = {}){
  return new Promise(resolve=>{
    _dialogResolve = resolve;
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMessage').textContent = message;
    document.getElementById('dialogInputWrap').style.display = 'none';
    document.getElementById('dialogCancelBtn').style.display = 'none';
    const okBtn = document.getElementById('dialogConfirmBtn');
    okBtn.textContent = 'OK';
    okBtn.className = 'btn btn-primary';
    okBtn.onclick = ()=>_closeDialog(true);
    document.getElementById('dialogOverlay').classList.add('active');
  });
}
function showConfirm(message, { title = 'Please confirm', confirmLabel = 'Confirm', danger = false } = {}){
  return new Promise(resolve=>{
    _dialogResolve = resolve;
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMessage').textContent = message;
    document.getElementById('dialogInputWrap').style.display = 'none';
    const cancelBtn = document.getElementById('dialogCancelBtn');
    cancelBtn.style.display = 'inline-flex';
    cancelBtn.onclick = ()=>_closeDialog(false);
    const okBtn = document.getElementById('dialogConfirmBtn');
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'btn btn-danger-solid' : 'btn btn-primary';
    okBtn.onclick = ()=>_closeDialog(true);
    document.getElementById('dialogOverlay').classList.add('active');
  });
}
function showPrompt(message, { title = 'Input needed', defaultValue = '', confirmLabel = 'OK', placeholder = '' } = {}){
  return new Promise(resolve=>{
    _dialogResolve = resolve;
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMessage').textContent = message;
    const inputWrap = document.getElementById('dialogInputWrap');
    const input = document.getElementById('dialogInput');
    inputWrap.style.display = 'block';
    input.value = defaultValue;
    input.placeholder = placeholder;
    const cancelBtn = document.getElementById('dialogCancelBtn');
    cancelBtn.style.display = 'inline-flex';
    cancelBtn.onclick = ()=>_closeDialog(null);
    const okBtn = document.getElementById('dialogConfirmBtn');
    okBtn.textContent = confirmLabel;
    okBtn.className = 'btn btn-primary';
    okBtn.onclick = ()=>_closeDialog(input.value);
    input.onkeydown = e=>{ if(e.key==='Enter') _closeDialog(input.value); };
    document.getElementById('dialogOverlay').classList.add('active');
    setTimeout(()=>input.focus(), 50);
  });
}
document.getElementById('dialogOverlay').addEventListener('click', e=>{
  if(e.target.id === 'dialogOverlay') _closeDialog(false);
});

/* ---------- Subscription gate (client-side pre-check) ---------- */
/* SUBSCRIPTION_ACTIVE is set by account.js once the real status is known.
   This is purely a friendlier UX layer — every action it guards is ALSO
   enforced server-side (Firestore rules for saving data, subscription
   checks in the backend for connecting platforms and calendar actions),
   so this check being skipped or bypassed never grants real access. */
function requireSubscriptionForAction(){
  if(typeof SUBSCRIPTION_ACTIVE !== 'undefined' && SUBSCRIPTION_ACTIVE) return true;
  showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to use this.", { title:'Subscription needed' });
  return false;
}

let firebaseApp = null, cloudAuth = null, cloudDb = null, cloudUser = null, cloudSaveTimer = null;
const STAGE_COLORS = ['stage-lead','stage-mid','stage-mid','stage-mid','stage-won','stage-lost'];

function defaultData(){
  const now = Date.now();
  const day = 86400000;
  return {
    settings:{ workspaceName:'Alba Business Desk' },
    stages:['Lead','Contacted','Proposal','Negotiation','Won','Lost'],
    contactStatuses:[
      {id:'st1',name:'Lead',category:'potential'},
      {id:'st2',name:'Client',category:'client'},
      {id:'st3',name:'Past Client',category:'client'},
      {id:'st4',name:'Partner',category:'other'},
      {id:'st5',name:'Vendor',category:'other'}
    ],
    leadSources:[
      {id:'ls1',name:'Referral'},
      {id:'ls2',name:'Website'},
      {id:'ls3',name:'Social media'},
      {id:'ls4',name:'Cold outreach'},
      {id:'ls5',name:'Trade show / event'},
      {id:'ls6',name:'Other'}
    ],
    companies:[
      {id:'co1',name:'Coastal Retail Group',industry:'Retail',website:'',notes:'',createdAt:now-40*day},
      {id:'co2',name:'Reddy & Sons Logistics',industry:'Logistics',website:'',notes:'',createdAt:now-12*day}
    ],
    customFieldDefs:{ contact:[], deal:[] },
    teamMembers:[
      {id:'tm1',name:'Nomvula Zulu'},
      {id:'tm2',name:'Sipho Dlamini'}
    ],
    lostReasons:[
      {id:'lr1',name:'Price'},{id:'lr2',name:'Bad timing'},{id:'lr3',name:'Chose a competitor'},
      {id:'lr4',name:'No budget'},{id:'lr5',name:'Went cold / unresponsive'},{id:'lr6',name:'Other'}
    ],
    salesTargets:[
      {id:'tg1',memberId:'team',period:'monthly',amount:90000,startDate:new Date(now).toISOString().slice(0,8)+'01'},
      {id:'tg2',memberId:'tm1',period:'monthly',amount:55000,startDate:new Date(now).toISOString().slice(0,8)+'01'},
      {id:'tg3',memberId:'tm2',period:'monthly',amount:35000,startDate:new Date(now).toISOString().slice(0,8)+'01'}
    ],
    contacts:[
      {id:'c1',name:'Naledi Khumalo',company:'Coastal Retail Group',companyId:'co1',source:'ls5',email:'naledi@coastalretail.co.za',phone:'+27 82 555 0142',tag:'Client',notes:'Prefers email over calls. Decision maker for the Q3 refresh.',customFields:{},createdAt:now-40*day},
      {id:'c2',name:'Michael Reddy',company:'Reddy & Sons Logistics',companyId:'co2',source:'ls5',email:'michael@reddylogistics.co.za',phone:'+27 71 555 0198',tag:'Lead',notes:'Met at the Durban trade expo.',customFields:{},createdAt:now-12*day},
      {id:'c3',name:'Priya Naidoo',company:'Naidoo Consulting',companyId:null,source:'ls1',email:'priya@naidooconsulting.com',phone:'+27 83 555 0110',tag:'Partner',notes:'',customFields:{},createdAt:now-70*day},
      {id:'c4',name:'Thabo Mokoena',company:'Mokoena Fresh Produce',companyId:null,source:'ls2',email:'thabo@mokoenafresh.co.za',phone:'+27 84 555 0177',tag:'Lead',notes:'Interested in the annual plan.',customFields:{},createdAt:now-3*day},
      {id:'c5',name:'Sandra Govender',company:'Govender & Partners Law',companyId:null,source:'ls3',email:'sandra@govenderlaw.co.za',phone:'+27 82 555 0163',tag:'Past Client',notes:'Website project wrapped up last year — worth a check-in.',customFields:{},createdAt:now-400*day}
    ],
    deals:[
      {id:'d1',title:'Brand refresh package',contactId:'c1',value:48000,stage:'Negotiation',priority:'high',probability:75,assignedTo:'tm1',lostReason:null,closeDate:new Date(now+9*day).toISOString().slice(0,10),customFields:{},createdAt:now-30*day,
        stageHistory:[{stage:'Lead',enteredAt:now-30*day},{stage:'Contacted',enteredAt:now-24*day},{stage:'Proposal',enteredAt:now-15*day},{stage:'Negotiation',enteredAt:now-5*day}]},
      {id:'d2',title:'Fleet tracking dashboard',contactId:'c2',value:22000,stage:'Contacted',priority:'medium',probability:25,assignedTo:'tm2',lostReason:null,closeDate:new Date(now+21*day).toISOString().slice(0,10),customFields:{},createdAt:now-10*day,
        stageHistory:[{stage:'Lead',enteredAt:now-10*day},{stage:'Contacted',enteredAt:now-6*day}]},
      {id:'d3',title:'Referral partnership',contactId:'c3',value:15000,stage:'Proposal',priority:'medium',probability:50,assignedTo:'tm1',lostReason:null,closeDate:new Date(now+14*day).toISOString().slice(0,10),customFields:{},createdAt:now-18*day,
        stageHistory:[{stage:'Lead',enteredAt:now-18*day},{stage:'Contacted',enteredAt:now-14*day},{stage:'Proposal',enteredAt:now-8*day}]},
      {id:'d4',title:'Seasonal campaign site',contactId:'c4',value:9500,stage:'Lead',priority:'low',probability:10,assignedTo:'tm2',lostReason:null,closeDate:new Date(now+30*day).toISOString().slice(0,10),customFields:{},createdAt:now-2*day,
        stageHistory:[{stage:'Lead',enteredAt:now-2*day}]},
      {id:'d5',title:'Loyalty app pilot',contactId:'c1',value:61000,stage:'Won',priority:'high',probability:100,assignedTo:'tm1',lostReason:null,closeDate:new Date(now-4*day).toISOString().slice(0,10),customFields:{},createdAt:now-55*day,
        stageHistory:[{stage:'Lead',enteredAt:now-55*day},{stage:'Contacted',enteredAt:now-48*day},{stage:'Proposal',enteredAt:now-35*day},{stage:'Negotiation',enteredAt:now-20*day},{stage:'Won',enteredAt:now-4*day}]},
      {id:'d6',title:'Warehouse signage',contactId:'c2',value:6000,stage:'Lost',priority:'low',probability:0,assignedTo:'tm2',lostReason:'lr1',closeDate:new Date(now-10*day).toISOString().slice(0,10),customFields:{},createdAt:now-40*day,
        stageHistory:[{stage:'Lead',enteredAt:now-40*day},{stage:'Contacted',enteredAt:now-32*day},{stage:'Lost',enteredAt:now-10*day}]},
      {id:'d7',title:'Firm website rebuild',contactId:'c5',value:34000,stage:'Won',priority:'medium',probability:100,assignedTo:'tm1',lostReason:null,closeDate:new Date(now-395*day).toISOString().slice(0,10),customFields:{},createdAt:now-430*day,
        stageHistory:[{stage:'Lead',enteredAt:now-430*day},{stage:'Proposal',enteredAt:now-420*day},{stage:'Won',enteredAt:now-395*day}]},
      {id:'d8',title:'Delivery app redesign',contactId:'c2',value:41000,stage:'Lost',priority:'medium',probability:0,assignedTo:'tm1',lostReason:'lr3',closeDate:new Date(now-25*day).toISOString().slice(0,10),customFields:{},createdAt:now-60*day,
        stageHistory:[{stage:'Lead',enteredAt:now-60*day},{stage:'Contacted',enteredAt:now-50*day},{stage:'Proposal',enteredAt:now-40*day},{stage:'Lost',enteredAt:now-25*day}]}
    ],
    tasks:[
      {id:'t1',title:'Send revised proposal to Naledi',dueDate:new Date(now+1*day).toISOString().slice(0,10),priority:'high',done:false,relatedId:'d1',relatedType:'deal',recurrence:{type:'none',interval:1}},
      {id:'t2',title:'Call Michael about timeline',dueDate:new Date(now-1*day).toISOString().slice(0,10),priority:'medium',done:false,relatedId:'c2',relatedType:'contact',recurrence:{type:'none',interval:1}},
      {id:'t3',title:'Prep partnership deck',dueDate:new Date(now+5*day).toISOString().slice(0,10),priority:'medium',done:false,relatedId:'d3',relatedType:'deal',recurrence:{type:'none',interval:1}},
      {id:'t4',title:'Send onboarding email',dueDate:new Date(now-6*day).toISOString().slice(0,10),priority:'low',done:true,relatedId:'c1',relatedType:'contact',recurrence:{type:'none',interval:1}},
      {id:'t5',title:'Weekly pipeline review',dueDate:new Date(now+2*day).toISOString().slice(0,10),priority:'low',done:false,relatedId:null,relatedType:null,recurrence:{type:'weekly',interval:1}}
    ],
    activity:[
      {id:'a1',text:'Marked "Loyalty app pilot" as Won',timestamp:now-4*day},
      {id:'a2',text:'Added deal "Seasonal campaign site" for Thabo Mokoena',timestamp:now-2*day},
      {id:'a3',text:'Moved "Brand refresh package" to Negotiation',timestamp:now-1*day},
      {id:'a4',text:'Added contact Thabo Mokoena',timestamp:now-3*day}
    ],
    socialPlatforms:[
      {id:'sp1',name:'Instagram',handle:'@yourstudio',followers:2840,createdAt:now-200*day},
      {id:'sp2',name:'Facebook',handle:'Your Studio',followers:1120,createdAt:now-200*day}
    ],
    socialSnapshots:[
      {id:'ss1',platformId:'sp1',followers:2600,date:new Date(now-60*day).toISOString().slice(0,10)},
      {id:'ss2',platformId:'sp1',followers:2720,date:new Date(now-30*day).toISOString().slice(0,10)},
      {id:'ss3',platformId:'sp1',followers:2840,date:new Date(now-2*day).toISOString().slice(0,10)},
      {id:'ss4',platformId:'sp2',followers:1050,date:new Date(now-60*day).toISOString().slice(0,10)},
      {id:'ss5',platformId:'sp2',followers:1120,date:new Date(now-2*day).toISOString().slice(0,10)}
    ],
    socialPosts:(function(){
      function dt(daysAgo, hour){ const d = new Date(now - daysAgo*day); d.setHours(hour,0,0,0); return d.toISOString(); }
      return [
        {id:'post1',platformId:'sp1',caption:'New brand identity for a local client',postedAt:dt(2,19),likes:184,comments:22,shares:9,reach:3100,createdAt:now-2*day},
        {id:'post2',platformId:'sp1',caption:'Studio tour behind the scenes',postedAt:dt(9,20),likes:210,comments:31,shares:14,reach:3600,createdAt:now-9*day},
        {id:'post3',platformId:'sp1',caption:'Before/after website redesign',postedAt:dt(16,8),likes:96,comments:8,shares:3,reach:1900,createdAt:now-16*day},
        {id:'post4',platformId:'sp1',caption:'Quick logo design tip',postedAt:dt(23,13),likes:74,comments:6,shares:2,reach:1500,createdAt:now-23*day},
        {id:'post5',platformId:'sp2',caption:'Client testimonial video',postedAt:dt(5,18),likes:58,comments:11,shares:7,reach:1200,createdAt:now-5*day},
        {id:'post6',platformId:'sp2',caption:'Portfolio highlight reel',postedAt:dt(12,9),likes:33,comments:3,shares:1,reach:800,createdAt:now-12*day},
        {id:'post7',platformId:'sp1',caption:'Wednesday design roundup',postedAt:dt(3,19),likes:201,comments:27,shares:12,reach:3300,createdAt:now-3*day},
        {id:'post8',platformId:'sp1',caption:'Client shoutout',postedAt:dt(19,14),likes:88,comments:9,shares:4,reach:1700,createdAt:now-19*day}
      ];
    })(),
    socialMentions:[
      {id:'m1',platformId:'sp1',account:'@coastalretailgroup',note:'Tagged us in their storefront reveal post',url:'',date:new Date(now-3*day).toISOString().slice(0,10),createdAt:now-3*day},
      {id:'m2',platformId:'sp2',account:'Durban Business Network',note:'Mentioned Alba Designs in a "local studios to watch" roundup',url:'',date:new Date(now-14*day).toISOString().slice(0,10),createdAt:now-14*day}
    ]
  };
}

function loadData(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(raw) return migrateData(JSON.parse(raw));
  }catch(e){}
  const d = defaultData();
  saveData(d);
  return d;
}
function migrateData(d){
  // Fill in any fields introduced by later versions of the app so older saved workspaces don't break.
  d.socialPlatforms = d.socialPlatforms || [];
  d.socialSnapshots = d.socialSnapshots || [];
  d.socialPosts = d.socialPosts || [];
  d.socialMentions = d.socialMentions || [];
  d.companies = d.companies || [];
  d.leadSources = d.leadSources || [
    {id:'ls1',name:'Referral'},{id:'ls2',name:'Website'},{id:'ls3',name:'Social media'},
    {id:'ls4',name:'Cold outreach'},{id:'ls5',name:'Trade show / event'},{id:'ls6',name:'Other'}
  ];
  d.contactStatuses = d.contactStatuses || [
    {id:'st1',name:'Lead',category:'potential'},{id:'st2',name:'Client',category:'client'},
    {id:'st3',name:'Past Client',category:'client'},{id:'st4',name:'Partner',category:'other'},
    {id:'st5',name:'Vendor',category:'other'}
  ];
  d.customFieldDefs = d.customFieldDefs || { contact:[], deal:[] };
  d.customFieldDefs.contact = d.customFieldDefs.contact || [];
  d.customFieldDefs.deal = d.customFieldDefs.deal || [];
  (d.contacts||[]).forEach(c=>{
    c.customFields = c.customFields || {};
    if(c.companyId===undefined) c.companyId = null;
    if(c.source===undefined) c.source = '';
  });
  (d.deals||[]).forEach(dl=>{ dl.customFields = dl.customFields || {}; });
  (d.tasks||[]).forEach(t=>{ t.recurrence = t.recurrence || {type:'none', interval:1}; });
  d.teamMembers = d.teamMembers || [];
  d.lostReasons = d.lostReasons || [
    {id:'lr1',name:'Price'},{id:'lr2',name:'Bad timing'},{id:'lr3',name:'Chose a competitor'},
    {id:'lr4',name:'No budget'},{id:'lr5',name:'Went cold / unresponsive'},{id:'lr6',name:'Other'}
  ];
  d.salesTargets = d.salesTargets || [];
  (d.deals||[]).forEach(dl=>{
    if(dl.assignedTo===undefined) dl.assignedTo = null;
    if(dl.lostReason===undefined) dl.lostReason = null;
    if(!dl.stageHistory){
      // Backfill a single history entry so velocity/conversion reports have something to work with
      dl.stageHistory = [{stage: dl.stage, enteredAt: dl.createdAt || Date.now()}];
    }
  });
  return d;
}
function saveData(d){
  localStorage.setItem(DB_KEY, JSON.stringify(d));
  if(cloudUser && cloudDb){
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(()=>{
      // Legacy entities go to the monolithic payload (migrated keys are
      // stripped inside pushCloudData). Migrated entities are diffed into
      // their own subcollections. Both are no-ops when there is nothing of
      // that kind to write, so this is safe in every migration state.
      pushCloudData();
      if(typeof syncMigratedEntities === 'function') syncMigratedEntities();
    }, 600);
  }
}
let DATA = loadData();

function logActivity(text, opts){
  opts = opts || {};
  DATA.activity.unshift({id:'a'+Date.now()+Math.floor(Math.random()*1000), text, timestamp:Date.now(),
    type: opts.type || 'System', relatedType: opts.relatedType || null, relatedId: opts.relatedId || null});
  DATA.activity = DATA.activity.slice(0,60);
}
function activityFor(relatedType, relatedId){
  return DATA.activity.filter(a=>a.relatedType===relatedType && a.relatedId===relatedId);
}



/* ---------- Helpers ---------- */
function uid(prefix){ return prefix + Date.now() + Math.floor(Math.random()*1000); }
function fmtMoney(n){ return 'R ' + Number(n||0).toLocaleString('en-ZA'); }
function fmtDate(s){ if(!s) return '—'; const d=new Date(s); return d.toLocaleDateString('en-ZA',{day:'numeric',month:'short'}); }
function timeAgo(ts){
  const diff = Date.now()-ts, m=60000,h=3600000,d=86400000;
  if(diff<h) return Math.max(1,Math.round(diff/m))+'m ago';
  if(diff<d) return Math.round(diff/h)+'h ago';
  return Math.round(diff/d)+'d ago';
}
function initials(name){
  return name.split(' ').filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join('');
}
function contactById(id){ return DATA.contacts.find(c=>c.id===id); }
function companyById(id){ return DATA.companies.find(co=>co.id===id); }
function dealById(id){ return DATA.deals.find(d=>d.id===id); }
function isOverdue(t){ return !t.done && t.dueDate && t.dueDate < new Date().toISOString().slice(0,10); }
function isDueToday(t){ return !t.done && t.dueDate === new Date().toISOString().slice(0,10); }

function renderNotifications(){
  const today = new Date().toISOString().slice(0,10);
  const relevant = DATA.tasks.filter(t=>!t.done && t.dueDate && t.dueDate<=today)
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const badge = document.getElementById('notifBadge');
  if(relevant.length){ badge.style.display='block'; badge.textContent = relevant.length>9?'9+':relevant.length; }
  else { badge.style.display='none'; }

  const dropdown = document.getElementById('notifDropdown');
  dropdown.innerHTML = relevant.length ? relevant.map(t=>`
    <div class="account-menu-item" data-notif-task="${t.id}" style="display:flex;justify-content:space-between;gap:10px;">
      <span>${escapeHtml(t.title)}</span>
      <span style="${isOverdue(t)?'color:var(--clay);':'color:var(--graphite);'}font-size:11.5px;white-space:nowrap;">${fmtDate(t.dueDate)}</span>
    </div>`).join('') : '<div class="account-menu-item" style="color:var(--graphite);cursor:default;">Nothing overdue or due today.</div>';
  dropdown.querySelectorAll('[data-notif-task]').forEach(el=>{
    el.addEventListener('click', ()=>{
      dropdown.classList.remove('open');
      showView('tasks');
      openTaskModal(el.dataset.notifTask);
    });
  });
}
document.getElementById('notifBellBtn').addEventListener('click', e=>{
  e.stopPropagation();
  document.getElementById('notifDropdown').classList.toggle('open');
});
document.addEventListener('click', ()=>{
  document.getElementById('notifDropdown').classList.remove('open');
});



/* ---------- Nav / views ---------- */
const views = {dashboard:'Dashboard',contacts:'Contacts',deals:'Pipeline',tasks:'Tasks',scheduling:'Calendar',reports:'Reports',social:'Social',billing:'Billing',settings:'Settings'};
const subs = {
  dashboard:'Your pipeline at a glance',
  contacts:"Everyone you're building a relationship with",
  deals:'Track every deal from lead to close',
  tasks:'What needs your attention',
  scheduling:'Your connected Google Calendar',
  reports:'How the business is trending',
  social:'Followers, engagement, and mentions across your platforms',
  billing:'Your subscription and payment history',
  settings:'Configure your workspace'
};
function showView(name){
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.view===name));
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active', el.id==='view-'+name));
  document.getElementById('topbarTitle').textContent = views[name];
  document.getElementById('topbarSub').textContent = subs[name];
  closeSidebar();
  renderAll();
  if(name==='billing' && cloudUser) refreshBilling();
}
document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>showView(el.dataset.view));
});
document.getElementById('dashTaskLink').addEventListener('click',()=>showView('tasks'));

function openSidebar(){
  document.querySelector('.sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('active');
  // Separate class from the auth gate's `no-scroll` so the two locks can
  // never clobber each other. Scoped to mobile widths in CSS, so it's inert
  // on desktop where the sidebar is permanent.
  document.body.classList.add('sidebar-open');
}
function closeSidebar(){
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('active');
  document.body.classList.remove('sidebar-open');
}
document.getElementById('menuToggle').addEventListener('click', openSidebar);
document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);



/* ---------- Modal close plumbing ---------- */
function closeModals(){
  document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('active'));
  editingContactId=null; editingDealId=null; editingTaskId=null;
  editingPlatformId=null; snapshotPlatformId=null; editingPostId=null; editingMentionId=null;
  editingCompanyId=null;
}
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',closeModals));
document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click',e=>{ if(e.target===ov) closeModals(); });
});



/* ---------- Search ---------- */
document.getElementById('globalSearch').addEventListener('input',()=>{
  renderContacts();
});



/* ---------- Util ---------- */
function escapeHtml(str){
  if(str===undefined||str===null) return '';
  return String(str).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* Strips anything except a small safe whitelist of formatting tags/attributes.
   Used before storing or re-displaying notes entered in the rich text editor. */
const RICHTEXT_ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','UL','OL','LI','A','BR','DIV','P','SPAN']);
function sanitizeHtml(html){
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  (function clean(node){
    Array.from(node.childNodes).forEach(child=>{
      if(child.nodeType === 1){ // element
        if(!RICHTEXT_ALLOWED_TAGS.has(child.tagName)){
          // Unwrap disallowed tags (e.g. <script>, <img>, <style>) but keep their text content
          const text = document.createTextNode(child.textContent);
          node.replaceChild(text, child);
          return;
        }
        Array.from(child.attributes).forEach(attr=>{
          if(child.tagName==='A' && attr.name==='href'){
            if(/^\s*javascript:/i.test(attr.value)) child.removeAttribute('href');
          } else {
            child.removeAttribute(attr.name);
          }
        });
        if(child.tagName==='A'){ child.setAttribute('target','_blank'); child.setAttribute('rel','noopener noreferrer'); }
        clean(child);
      } else if(child.nodeType !== 3){ // strip comments etc, keep text nodes
        node.removeChild(child);
      }
    });
  })(temp);
  return temp.innerHTML;
}
function wireRichTextToolbar(container){
  container.querySelectorAll('.rt-btn').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.preventDefault();
      const cmd = btn.dataset.rtCmd;
      if(cmd==='createLink'){
        const url = await showPrompt('Enter the link URL:', { title:'Add link', defaultValue:'https://', confirmLabel:'Add link' });
        if(url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });
}
document.querySelectorAll('.richtext-toolbar').forEach(wireRichTextToolbar);



/* ---------- Theme ---------- */
function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
  document.querySelectorAll('.theme-toggle-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.themeChoice===theme);
  });
  const logo = document.getElementById('brandLogo');
  if(logo){
    const nextSrc = theme==='dark' ? LOGO_WHITE_DATA_URI : LOGO_BLACK_DATA_URI;
    if(!logo.getAttribute('src')){
      logo.src = nextSrc; // initial load — show immediately, no fade
    } else if(logo.src !== nextSrc){
      logo.style.opacity = '0';
      setTimeout(()=>{ logo.src = nextSrc; logo.style.opacity = '1'; }, 150);
    }
  }
  const gateLogo = document.getElementById('loginGateLogo');
  if(gateLogo){
    gateLogo.src = theme==='dark' ? LOGO_WHITE_DATA_URI : LOGO_BLACK_DATA_URI;
  }
  const loadingLogo = document.getElementById('authLoadingLogo');
  if(loadingLogo){
    loadingLogo.src = theme==='dark' ? LOGO_WHITE_DATA_URI : LOGO_BLACK_DATA_URI;
  }
}
document.querySelectorAll('.theme-toggle-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>setTheme(btn.dataset.themeChoice));
});
setTheme(document.documentElement.getAttribute('data-theme') || 'light');

/* ---------- Cookie consent banner ---------- */
(function initCookieBanner(){
  const CONSENT_KEY = 'abd_cookie_consent';
  const banner = document.getElementById('cookieBanner');
  if(!banner) return;
  try{
    if(!localStorage.getItem(CONSENT_KEY)){
      banner.style.display = 'flex';
    }
  }catch(e){ banner.style.display = 'flex'; }
  const acceptBtn = document.getElementById('cookieBannerAccept');
  if(acceptBtn){
    acceptBtn.addEventListener('click', ()=>{
      try{ localStorage.setItem(CONSENT_KEY, String(Date.now())); }catch(e){}
      banner.style.display = 'none';
    });
  }
})();
