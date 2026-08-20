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
  // Don't accuse a paying user of being in view-only mode just because the
  // status check hasn't come back yet — that was a real false positive.
  if(typeof SUBSCRIPTION_KNOWN !== 'undefined' && !SUBSCRIPTION_KNOWN){
    showAlert('Still checking your subscription — give it a second and try again.', { title:'One moment' });
    if(typeof refreshSubscriptionStatus === 'function') refreshSubscriptionStatus();
    return false;
  }
  showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to use this.", { title:'Subscription needed' });
  return false;
}

let firebaseApp = null, cloudAuth = null, cloudDb = null, cloudUser = null, cloudSaveTimer = null;
const STAGE_COLORS = ['stage-lead','stage-mid','stage-mid','stage-mid','stage-won','stage-lost'];

function defaultData(){
  /* Configuration defaults only. Entity collections start EMPTY — a new
     workspace should not be pre-populated with invented contacts and deals;
     the empty states guide the user instead. Entities are hydrated from
     Firestore once the organisation is resolved. */
  return {
    settings:{ workspaceName:'Alba Business Desk' },
    stages:['Lead','Contacted','Proposal','Negotiation','Won','Lost'],
    contactStatuses:[
      {id:'st1',name:'Lead',category:'potential'},
      {id:'st2',name:'Client',category:'client'},
      {id:'st3',name:'Past client',category:'client'},
      {id:'st4',name:'Partner',category:'other'},
      {id:'st5',name:'Supplier',category:'other'}
    ],
    leadSources:[
      {id:'ls1',name:'Referral'},
      {id:'ls2',name:'Website'},
      {id:'ls3',name:'Social media'},
      {id:'ls4',name:'Cold outreach'},
      {id:'ls5',name:'Event'},
      {id:'ls6',name:'Other'}
    ],
    customFieldDefs:{ contact:[], deal:[] },
    teamMembers:[
      {id:'tm1',name:'You'}
    ],
    lostReasons:[
      {id:'lr1',name:'Price'},
      {id:'lr2',name:'Timing'},
      {id:'lr3',name:'Went with a competitor'},
      {id:'lr4',name:'No budget'},
      {id:'lr5',name:'No response'},
      {id:'lr6',name:'Other'}
    ],
    salesTargets:[],
    companies:[],
    contacts:[],
    deals:[],
    tasks:[],
    activity:[],
    socialPlatforms:[],
    socialSnapshots:[],
    socialPosts:[],
    socialMentions:[]
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
  // localStorage is a fast local cache only — Firestore is authoritative.
  try{ localStorage.setItem(DB_KEY, JSON.stringify(d)); }catch(e){}
  if(cloudUser && cloudDb && typeof syncWorkspace === 'function'){
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(syncWorkspace, 600);
  }
}

let DATA = loadData();

function logActivity(text, opts){
  opts = opts || {};
  DATA.activity.unshift({id:'a'+Date.now()+Math.floor(Math.random()*1000), text, timestamp:Date.now(),
    type: opts.type || 'System', relatedType: opts.relatedType || null, relatedId: opts.relatedId || null});
  DATA.activity = DATA.activity.slice(0,60);
}
/* Activity documents should always carry `text` and `timestamp` (see
   logActivity above). These accessors exist because a single malformed
   record — one written by an older build, or partially saved — should degrade
   to a readable line rather than rendering "undefined / NaNd ago" and making
   the whole dashboard look broken. */
function activityText(a){
  if(!a) return 'Activity';
  return a.text || a.title || a.description || 'Activity';
}
function activityTime(a){
  if(!a) return null;
  return a.timestamp !== undefined ? a.timestamp : (a.createdAt !== undefined ? a.createdAt : null);
}

function activityFor(relatedType, relatedId){
  return DATA.activity.filter(a=>a.relatedType===relatedType && a.relatedId===relatedId);
}



/* ---------- Helpers ---------- */
function uid(prefix){ return prefix + Date.now() + Math.floor(Math.random()*1000); }
function fmtMoney(n){ return 'R ' + Number(n||0).toLocaleString('en-ZA'); }
function fmtDate(s){ if(!s) return '—'; const d=new Date(s); return d.toLocaleDateString('en-ZA',{day:'numeric',month:'short'}); }
function timeAgo(ts){
  // Accept a number, an ISO string, or a Firestore Timestamp. Anything
  // unparseable returns a neutral label rather than "NaNd ago".
  let t = ts;
  if(t && typeof t === 'object' && typeof t.toMillis === 'function') t = t.toMillis();
  if(typeof t === 'string') t = Date.parse(t);
  if(typeof t !== 'number' || !isFinite(t)) return 'recently';
  const diff = Date.now()-t, m=60000,h=3600000,d=86400000;
  if(diff < 0) return 'just now';
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
/* The app stores dates as 'YYYY-MM-DD' strings (what <input type="date">
   produces, and what the sorts and comparisons here assume). Documents
   written by an earlier build stored some of them as numeric timestamps,
   which made `.localeCompare` blow up. This coerces any of number, Date,
   Firestore Timestamp or ISO string to the expected string form. */
function toDateStr(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'string') return v.length > 10 ? v.slice(0,10) : v;
  if(typeof v === 'object' && typeof v.toMillis === 'function') v = v.toMillis();
  if(v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0,10);
  if(typeof v === 'number' && isFinite(v)){
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
  }
  return '';
}
/* Sort comparator that never throws, whatever the stored type. */
function byDateStr(a, b){ return toDateStr(a).localeCompare(toDateStr(b)); }

function isOverdue(t){ const d = toDateStr(t.dueDate); return !t.done && !!d && d < new Date().toISOString().slice(0,10); }
function isDueToday(t){ return !t.done && toDateStr(t.dueDate) === new Date().toISOString().slice(0,10); }

function renderNotifications(){
  const today = new Date().toISOString().slice(0,10);
  const relevant = DATA.tasks.filter(t=>!t.done && toDateStr(t.dueDate) && toDateStr(t.dueDate)<=today)
    .sort((a,b)=>byDateStr(a.dueDate, b.dueDate));
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
