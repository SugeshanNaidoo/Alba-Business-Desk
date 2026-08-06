// Sign-in, session/cookie handling, and billing/subscription UI.
// These stay together deliberately rather than split into separate
// auth vs. billing files — the code is genuinely interleaved (billing
// UI updates happen directly inside the sign-in state handlers), and
// forcing them apart risked breaking real references rather than just
// reorganizing files. Covers: Google sign-in, the backend session
// cookie + CSRF token, and the Billing tab (status, history, checkout,
// cancel, delete account, statement downloads).

/* ---------- Cloud sync ---------- */
/* This workspace's Firebase project — set this up once (see the setup notes
   shared alongside this file) and paste the config object below. End users
   never see or touch this; they only ever see a "Sign in with Google" button.
   Leave as null to keep the workspace local-only. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDMEPG276kusJKvLuOqDwefYDP5M1X_Qo0",
  authDomain: "alba-business-desk.firebaseapp.com",
  projectId: "alba-business-desk",
  storageBucket: "alba-business-desk.firebasestorage.app",
  messagingSenderId: "654324393270",
  appId: "1:654324393270:web:8891dfadd2d4088ff0bf97"
};

function updateSidebarStatus(){
  const el = document.getElementById('sidebarStatus');
  if(cloudUser){
    el.innerHTML = `Signed in as <strong style="color:var(--ink);">${escapeHtml(cloudUser.displayName||cloudUser.email||'Google account')}</strong> &middot; synced to the cloud`;
  } else {
    el.textContent = 'Local workspace · data stored on this device';
  }
}
function getCsrfToken(){
  const match = document.cookie.match(/(?:^|; )abd_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}
async function establishBackendSession(){
  const base = BACKEND_BASE;
  if(!cloudUser) return;
  try{
    const idToken = await cloudUser.getIdToken();
    await fetch(`${base}/api/session?action=login`, {
      method: 'POST', credentials: 'include',
      headers: { Authorization: `Bearer ${idToken}` }
    });
  }catch(err){
    console.error('Could not establish a backend session — billing features may be unavailable.', err);
  }
}

function showSignedIn(user){
  document.getElementById('loginGate').classList.remove('active');
  document.getElementById('sidebarSignInBtn').style.display = 'none';
  document.getElementById('sidebarAccountChip').style.display = 'flex';
  document.getElementById('sidebarUserName').textContent = user.displayName || user.email || 'Signed in';
  const sidebarPhoto = document.getElementById('sidebarUserPhoto');
  if(user.photoURL){ sidebarPhoto.src = user.photoURL; sidebarPhoto.style.display='block'; } else sidebarPhoto.style.display='none';

  document.getElementById('cloudSignedOutView').style.display = 'none';
  document.getElementById('cloudSignedInView').style.display = 'block';
  document.getElementById('cloudUserName').textContent = user.displayName || 'Signed in';
  document.getElementById('cloudUserEmail').textContent = user.email || '';
  const photo = document.getElementById('cloudUserPhoto');
  if(user.photoURL){ photo.src = user.photoURL; photo.style.display = 'inline-block'; } else { photo.style.display = 'none'; }
  document.getElementById('cloudUserUid').value = user.uid || '';
  updateSidebarStatus();

  document.getElementById('billingSignedOutNote').style.display = 'none';
  document.getElementById('billingSignedInView').style.display = 'block';
  establishBackendSession().then(refreshBilling);
}
function showSignedOut(){
  document.getElementById('loginGate').classList.add('active');
  subscriptionCheckedOnce = false;
  document.getElementById('sidebarSignInBtn').style.display = 'flex';
  document.getElementById('sidebarAccountChip').style.display = 'none';

  document.getElementById('cloudSignedOutView').style.display = 'block';
  document.getElementById('cloudSignedInView').style.display = 'none';
  updateSidebarStatus();

  document.getElementById('billingSignedOutNote').style.display = 'block';
  document.getElementById('billingSignedInView').style.display = 'none';
}

const SUBSCRIPTION_LABELS = {
  active: 'Active',
  none: 'Not subscribed',
  payment_failed: 'Payment failed — please update your card',
  cancelled: 'Cancelled',
  pending: 'Pending'
};

function billingApiBase(){ return BACKEND_BASE; }

async function refreshBilling(){
  await refreshSubscriptionStatus();
  await refreshPaymentHistory();
}

let SUBSCRIPTION_ACTIVE = false;
let subscriptionCheckedOnce = false;

async function refreshSubscriptionStatus(){
  const textEl = document.getElementById('billingStatusText');
  const subscribeBtn = document.getElementById('billingSubscribeBtn');
  const cancelBtn = document.getElementById('billingCancelBtn');
  const lastPaymentRow = document.getElementById('billingLastPaymentRow');
  const base = billingApiBase();
  if(!cloudUser){
    textEl.textContent = 'Sign in to check';
    return;
  }
  textEl.textContent = 'Checking…';
  try{
    const res = await fetch(`${base}/api/billing?action=status`, { credentials: 'include' });
    const data = await res.json();
    const status = data.status || 'none';
    textEl.textContent = SUBSCRIPTION_LABELS[status] || status;
    const isActive = status === 'active';
    SUBSCRIPTION_ACTIVE = isActive;
    subscribeBtn.style.display = isActive ? 'none' : 'inline-flex';
    cancelBtn.style.display = isActive ? 'inline-flex' : 'none';
    if(data.lastPaymentAt){
      lastPaymentRow.style.display = 'flex';
      document.getElementById('billingLastPaymentText').textContent = new Date(data.lastPaymentAt).toLocaleString('en-ZA');
    } else {
      lastPaymentRow.style.display = 'none';
    }
    document.getElementById('subscribeBanner').style.display = isActive ? 'none' : 'flex';
    // First check after signing in: if not subscribed, take them straight
    // to Billing rather than leaving them to stumble on it — they can
    // still navigate anywhere else from there, this is a one-time nudge.
    if(!subscriptionCheckedOnce){
      subscriptionCheckedOnce = true;
      if(!isActive) showView('billing');
    }
  }catch(err){
    textEl.textContent = 'Could not check status';
  }
}

async function refreshPaymentHistory(){
  const tbody = document.getElementById('billingHistoryTbody');
  const emptyEl = document.getElementById('billingHistoryEmpty');
  const base = billingApiBase();
  if(!cloudUser){ tbody.innerHTML=''; emptyEl.style.display='block'; return; }
  try{
    const res = await fetch(`${base}/api/billing?action=history`, { credentials: 'include' });
    const data = await res.json();
    const payments = data.payments || [];
    emptyEl.style.display = payments.length ? 'none' : 'block';
    tbody.innerHTML = payments.map(p => `
      <tr>
        <td>${new Date(p.date).toLocaleString('en-ZA')}</td>
        <td class="mono">${fmtMoney(p.amount)}</td>
        <td class="sub-cell">${escapeHtml(p.pfPaymentId||p.id||'—')}</td>
        <td><button class="btn btn-ghost btn-sm" data-statement="${p.id}">Download statement</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-statement]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const payment = payments.find(p => p.id === btn.dataset.statement);
        if(payment) downloadStatement(payment);
      });
    });
  }catch(err){
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
  }
}

function downloadStatement(payment){
  const date = new Date(payment.date);
  const monthLabel = date.toLocaleDateString('en-ZA', { month:'long', year:'numeric' });
  const workspaceName = DATA.settings.workspaceName || 'Alba Business Desk';
  const accountEmail = cloudUser ? (cloudUser.email||'') : '';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const ink = [29,29,31], graphite = [110,110,115], line = [229,229,231];

  // Logo (falls back gracefully to a text wordmark if it can't be embedded)
  try{
    const logoW = 42, logoH = logoW * (149/640);
    doc.addImage(LOGO_BLACK_DATA_URI, 'PNG', margin, 15, logoW, logoH);
  }catch(e){
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...ink);
    doc.text(workspaceName, margin, 22);
  }

  let y = 38;
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(...ink);
  doc.text('Statement', margin, y);
  y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(...graphite);
  doc.text(monthLabel, margin, y);

  y += 12;
  doc.setDrawColor(...line);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  const rows = [
    ['Billed to', accountEmail || '—'],
    ['Payment date', date.toLocaleString('en-ZA')],
    ['Reference', payment.pfPaymentId || payment.id || '—'],
    ['Description', `${workspaceName} — monthly subscription`]
  ];
  rows.forEach(([label, value])=>{
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...graphite);
    doc.text(label.toUpperCase(), margin, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(...ink);
    doc.text(String(value), margin + 45, y);
    y += 9;
  });

  y += 8;
  doc.setDrawColor(...line);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;

  doc.setFont('helvetica','bold'); doc.setFontSize(24); doc.setTextColor(...ink);
  doc.text(`R ${Number(payment.amount||0).toLocaleString('en-ZA',{minimumFractionDigits:2})}`, margin, y);

  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...graphite);
  doc.text(`Generated from ${workspaceName} on ${new Date().toLocaleString('en-ZA')}.`, margin, doc.internal.pageSize.getHeight() - 15);

  doc.save(`statement-${date.toISOString().slice(0,7)}.pdf`);
}

document.getElementById('billingSubscribeBtn').addEventListener('click', async ()=>{
  const base = billingApiBase();
  if(!cloudUser){ await showAlert('Sign in with Google first.'); return; }
  await establishBackendSession(); // make sure the session cookie is fresh before this full-page navigation
  window.location.href = `${base}/api/billing?action=checkout`;
});

document.getElementById('billingCancelBtn').addEventListener('click', async ()=>{
  const base = billingApiBase();
  if(!cloudUser) return;
  if(!(await showConfirm('Cancel your subscription? You will not be charged again, and access continues until PayFast confirms the cancellation.', { title:'Cancel subscription', confirmLabel:'Cancel subscription', danger:true }))) return;
  const btn = document.getElementById('billingCancelBtn');
  btn.disabled = true; btn.textContent = 'Cancelling…';
  try{
    const res = await fetch(`${base}/api/billing?action=cancel`, {
      method:'POST', credentials:'include',
      headers:{ 'X-CSRF-Token': getCsrfToken() }
    });
    const data = await res.json();
    if(!res.ok){ await showAlert(data.error || 'Could not cancel — please try again.'); }
    else { await showAlert('Subscription cancelled.'); }
  }catch(err){
    await showAlert('Could not reach the billing backend.');
  }
  btn.disabled = false; btn.textContent = 'Cancel subscription';
  refreshSubscriptionStatus();
});

document.getElementById('billingDeleteAccountBtn').addEventListener('click', async ()=>{
  const base = billingApiBase();
  if(!cloudUser) return;
  const typed = await showPrompt('This permanently deletes your account, cancels any active subscription first, and removes all your CRM data. This cannot be undone.\n\nType DELETE to confirm.', { title:'Delete account', confirmLabel:'Delete account', placeholder:'DELETE' });
  if(typed !== 'DELETE') return;
  const btn = document.getElementById('billingDeleteAccountBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try{
    const res = await fetch(`${base}/api/billing?action=delete-account`, {
      method:'POST', credentials:'include',
      headers:{ 'X-CSRF-Token': getCsrfToken() }
    });
    const data = await res.json();
    if(!res.ok){
      await showAlert(data.error || 'Could not delete your account — please try again.');
      btn.disabled = false; btn.textContent = 'Delete my account & all data';
      return;
    }
    await showAlert('Your account and all data have been deleted.');
    await endBackendSession();
    if(cloudAuth) cloudAuth.signOut();
    localStorage.removeItem(DB_KEY);
    DATA = defaultData();
    saveData(DATA);
    renderAll();
  }catch(err){
    await showAlert('Could not reach the billing backend.');
    btn.disabled = false; btn.textContent = 'Delete my account & all data';
  }
});

/* If we've just been redirected back from PayFast, show the result */
(async function handleBillingRedirect(){
  const params = new URLSearchParams(window.location.search);
  const result = params.get('billing');
  if(!result) return;
  if(result === 'success') await showAlert('Payment received — thank you! It may take a few seconds for your subscription status to update.');
  if(result === 'cancelled') await showAlert('Checkout was cancelled — no payment was made.');
  params.delete('billing');
  const newUrl = window.location.pathname + (params.toString() ? '?'+params.toString() : '');
  window.history.replaceState({}, '', newUrl);
})();

let hasWarnedAboutBlockedSave = false;
function pushCloudData(){
  if(!cloudUser || !cloudDb) return;
  cloudDb.collection('flowline_crm_users').doc(cloudUser.uid).set({
    payload: JSON.stringify(DATA), updatedAt: Date.now()
  }).then(()=>{
    const el = document.getElementById('cloudSyncStatus');
    if(el) el.textContent = 'Synced to the cloud.';
  }).catch(err=>{
    console.error(err);
    const el = document.getElementById('cloudSyncStatus');
    if(err && err.code === 'permission-denied'){
      if(el) el.textContent = 'Changes are not being saved — subscribe to keep them.';
      if(!SUBSCRIPTION_ACTIVE && !hasWarnedAboutBlockedSave){
        hasWarnedAboutBlockedSave = true;
        showAlert("You're exploring in view-only mode. Subscribe from the Billing tab to save your changes.", { title:'Subscription needed' });
      }
      return;
    }
    if(el) el.textContent = 'Cloud sync failed — your changes are still saved on this device.';
  });
}
function pullCloudData(){
  const el = document.getElementById('cloudSyncStatus');
  cloudDb.collection('flowline_crm_users').doc(cloudUser.uid).get().then(doc=>{
    if(doc.exists && doc.data().payload){
      try{
        DATA = migrateData(JSON.parse(doc.data().payload));
        saveData(DATA);
        renderAll();
      }catch(e){ console.error(e); }
    } else {
      // First time this account has signed in. Deliberately start from a
      // clean default workspace rather than pushing up whatever happens to
      // be sitting in this browser's local storage — on a shared or
      // previously-used device, that could belong to someone else entirely.
      DATA = defaultData();
      saveData(DATA);
      renderAll();
      pushCloudData();
    }
    if(el) el.textContent = 'Synced to the cloud.';
  }).catch(err=>{
    console.error(err);
    if(el) el.textContent = 'Could not reach the cloud — working from this device only.';
  });
}
function handleAuthChange(user){
  document.getElementById('authLoadingOverlay').classList.remove('active');
  cloudUser = user || null;
  if(cloudUser){ showSignedIn(cloudUser); pullCloudData(); }
  else { showSignedOut(); }
}
function connectFirebase(config){
  if(typeof firebase === 'undefined'){ console.error('Firebase SDK did not load.'); return; }
  try{
    firebaseApp = firebaseApp || firebase.initializeApp(config);
    cloudAuth = firebase.auth();
    cloudDb = firebase.firestore();
    cloudAuth.onAuthStateChanged(handleAuthChange);
  }catch(err){
    console.error(err);
  }
}
function requestGoogleSignIn(){
  if(!FIREBASE_CONFIG){
    showAlert('Cloud sync isn\'t configured for this workspace yet.');
    return;
  }
  if(!cloudAuth){ connectFirebase(FIREBASE_CONFIG); }
  const provider = new firebase.auth.GoogleAuthProvider();
  cloudAuth.signInWithPopup(provider).catch(err=>{
    if(err && err.code !== 'auth/popup-closed-by-user') showAlert('Sign-in did not complete: ' + err.message);
  });
}
async function endBackendSession(){
  const base = billingApiBase();
  try{
    await fetch(`${base}/api/session?action=logout`, { method:'POST', credentials:'include' });
  }catch(err){ /* best effort — client-side sign-out still proceeds */ }
}
document.getElementById('sidebarSignInBtn').addEventListener('click', requestGoogleSignIn);
document.getElementById('loginGateSignInBtn').addEventListener('click', requestGoogleSignIn);
document.getElementById('subscribeBannerBtn').addEventListener('click', ()=>showView('billing'));
document.getElementById('sidebarSignOutBtn').addEventListener('click',()=>{
  endBackendSession();
  if(cloudAuth) cloudAuth.signOut();
  document.getElementById('sidebarAccountMenu').classList.remove('open');
});
document.getElementById('googleSignOutBtnSettings').addEventListener('click',()=>{
  endBackendSession();
  if(cloudAuth) cloudAuth.signOut();
});
document.getElementById('sidebarAccountMenuBtn').addEventListener('click', e=>{
  e.stopPropagation();
  document.getElementById('sidebarAccountMenu').classList.toggle('open');
});
document.addEventListener('click', ()=>{
  document.getElementById('sidebarAccountMenu').classList.remove('open');
});

// The sign-in button is always visible; if cloud sync isn't configured yet,
// clicking it just explains that instead of hiding the feature entirely.
document.getElementById('sidebarSignInBtn').style.display = 'flex';
if(FIREBASE_CONFIG){
  document.getElementById('cloudUnconfiguredNote').style.display = 'none';
  connectFirebase(FIREBASE_CONFIG);
}

