// Runs last, after every other file has defined its render functions —
// this is what actually kicks off the first render and starts the
// session-inactivity watcher.

/* ---------- Init ---------- */
function renderAll(){
  document.title = DATA.settings.workspaceName;
  renderDashboard();
  renderContacts();
  renderBoard();
  renderTasks();
  renderScheduling();
  renderReports();
  renderSocial();
  renderSettings();
  renderNotifications();
}
renderAll();

/* Safety net: handleAuthChange normally hides this within moments of page
   load. If Firebase somehow never initializes (a load failure, a
   misconfiguration), fall back to the sign-in screen after a few seconds
   rather than leaving someone stuck on a blank page forever. */
setTimeout(()=>{
  const overlay = document.getElementById('authLoadingOverlay');
  if(overlay && overlay.classList.contains('active')){
    overlay.classList.remove('active');
    if(!cloudUser) document.getElementById('loginGate').classList.add('active');
  }
}, 6000);



/* ---------- Session inactivity timeout ---------- */
/* If the tab is left open and untouched, make sure the latest work is
   saved to the cloud and sign out — so a device left unlocked doesn't
   stay signed into someone's account indefinitely. */
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
let lastActivityAt = Date.now();
['mousemove','mousedown','keydown','scroll','touchstart'].forEach(evt=>{
  document.addEventListener(evt, ()=>{ lastActivityAt = Date.now(); }, { passive:true });
});
setInterval(()=>{
  if(!cloudUser) return; // nothing to time out for local-only use
  if(Date.now() - lastActivityAt < INACTIVITY_LIMIT_MS) return;
  pushCloudData(); // make sure the latest changes are saved before signing out
  setTimeout(()=>{ endBackendSession(); if(cloudAuth) cloudAuth.signOut(); }, 800); // brief pause so the save can land
}, 60 * 1000); // check once a minute
