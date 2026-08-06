// WhatsApp chat: connecting a number in Settings, and chatting with a
// contact directly from their drawer. Every action here requires being
// signed in, and sending/connecting requires an active subscription —
// same pattern as everything else.

/* ---------- Settings: connect / disconnect ---------- */
async function refreshWhatsappSettingsStatus(){
  const signedOutNote = document.getElementById('waSignedOutSettingsNote');
  const connectedView = document.getElementById('waSettingsConnectedView');
  if(!cloudUser){
    signedOutNote.style.display = 'block';
    connectedView.style.display = 'none';
    return;
  }
  signedOutNote.style.display = 'none';
  connectedView.style.display = 'block';
  try{
    const res = await fetch(`${BACKEND_BASE}/api/whatsapp?action=status`, { credentials:'include' });
    const data = await res.json();
    const form = document.getElementById('waNotConnectedForm');
    const info = document.getElementById('waConnectedInfo');
    if(data.connected){
      form.style.display = 'none';
      info.style.display = 'block';
      document.getElementById('waDisplayNumber').textContent = data.displayPhoneNumber || '—';
    } else {
      form.style.display = 'block';
      info.style.display = 'none';
    }
  }catch(err){
    console.error('Could not check WhatsApp status', err);
  }
}

document.getElementById('waConnectBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  const phoneNumberId = document.getElementById('waPhoneNumberId').value.trim();
  const wabaId = document.getElementById('waWabaId').value.trim();
  const accessToken = document.getElementById('waAccessToken').value.trim();
  const errEl = document.getElementById('waConnectError');
  errEl.style.display = 'none';
  if(!phoneNumberId || !wabaId || !accessToken){
    errEl.textContent = 'Please fill in all three fields.';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('waConnectBtn');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try{
    const res = await fetch(`${BACKEND_BASE}/api/whatsapp?action=connect`, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ phoneNumberId, wabaId, accessToken })
    });
    const data = await res.json();
    if(!res.ok){
      errEl.textContent = data.error || 'Could not connect — please check the details and try again.';
      errEl.style.display = 'block';
    } else {
      document.getElementById('waPhoneNumberId').value = '';
      document.getElementById('waWabaId').value = '';
      document.getElementById('waAccessToken').value = '';
      refreshWhatsappSettingsStatus();
    }
  }catch(err){
    errEl.textContent = 'Could not reach the backend.';
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Connect WhatsApp';
});

document.getElementById('waDisconnectBtn').addEventListener('click', async ()=>{
  if(!(await showConfirm('Disconnect WhatsApp? You can reconnect later with the same or a different number.', { title:'Disconnect WhatsApp', confirmLabel:'Disconnect', danger:true }))) return;
  try{
    await fetch(`${BACKEND_BASE}/api/whatsapp?action=disconnect`, {
      method:'POST', credentials:'include',
      headers:{ 'X-CSRF-Token': getCsrfToken() }
    });
  }catch(err){ /* best effort */ }
  refreshWhatsappSettingsStatus();
});

/* ---------- Contact drawer: chat panel ---------- */
let waPollTimer = null;
let waCurrentContactPhone = null;
let waCanSendFreeForm = false;

function waNormalize(phone){
  return (phone || '').replace(/[^\d]/g, '');
}

async function initWhatsappPanelForContact(contact){
  stopWhatsappPolling();
  const notConnectedNote = document.getElementById('waNotConnectedNote');
  const noPhoneNote = document.getElementById('waNoPhoneNote');
  const chatWrap = document.getElementById('waChatWrap');
  notConnectedNote.style.display = 'none';
  noPhoneNote.style.display = 'none';
  chatWrap.style.display = 'none';

  if(!cloudUser) return; // section stays hidden-ish; drawer works fine without WhatsApp
  const phone = waNormalize(contact.phone);
  if(!phone){
    noPhoneNote.style.display = 'block';
    return;
  }
  try{
    const statusRes = await fetch(`${BACKEND_BASE}/api/whatsapp?action=status`, { credentials:'include' });
    const statusData = await statusRes.json();
    if(!statusData.connected){
      notConnectedNote.style.display = 'block';
      return;
    }
  }catch(err){
    notConnectedNote.style.display = 'block';
    return;
  }

  waCurrentContactPhone = phone;
  chatWrap.style.display = 'block';
  await loadWhatsappMessages(phone);
  waPollTimer = setInterval(()=>{ if(waCurrentContactPhone) loadWhatsappMessages(waCurrentContactPhone, true); }, 8000);
}

function stopWhatsappPolling(){
  if(waPollTimer){ clearInterval(waPollTimer); waPollTimer = null; }
  waCurrentContactPhone = null;
}

async function loadWhatsappMessages(phone, silent){
  const threadEl = document.getElementById('waMessageThread');
  if(!silent) threadEl.innerHTML = `<p class="topbar-sub" style="padding:8px;">Loading…</p>`;
  try{
    const res = await fetch(`${BACKEND_BASE}/api/whatsapp?action=get-messages&contactPhone=${encodeURIComponent(phone)}`, { credentials:'include' });
    const data = await res.json();
    if(!res.ok) return;
    waCanSendFreeForm = !!data.canSendFreeForm;
    document.getElementById('waWindowClosedNote').style.display = waCanSendFreeForm ? 'none' : 'block';
    document.getElementById('waComposeWrap').style.display = waCanSendFreeForm ? 'flex' : 'none';

    const messages = data.messages || [];
    if(!messages.length){
      threadEl.innerHTML = `<p class="topbar-sub" style="padding:8px;">No messages yet.</p>`;
      return;
    }
    threadEl.innerHTML = messages.map(m=>{
      const time = new Date(m.timestamp).toLocaleString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<div class="wa-msg wa-msg-${m.direction}">${escapeHtml(m.body)}<span class="wa-msg-time">${time}</span></div>`;
    }).join('');
    threadEl.scrollTop = threadEl.scrollHeight;
  }catch(err){
    if(!silent) threadEl.innerHTML = `<p class="topbar-sub" style="padding:8px;">Could not load messages.</p>`;
  }
}

document.getElementById('waSendBtn').addEventListener('click', async ()=>{
  if(!requireSubscriptionForAction()) return;
  const input = document.getElementById('waMessageInput');
  const body = input.value.trim();
  if(!body || !waCurrentContactPhone) return;
  const btn = document.getElementById('waSendBtn');
  btn.disabled = true;
  try{
    const res = await fetch(`${BACKEND_BASE}/api/whatsapp?action=send-message`, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ contactPhone: waCurrentContactPhone, body })
    });
    const data = await res.json();
    if(!res.ok){
      await showAlert(data.error || 'Could not send that message.');
    } else {
      input.value = '';
      await loadWhatsappMessages(waCurrentContactPhone);
    }
  }catch(err){
    await showAlert('Could not reach the backend.');
  }
  btn.disabled = false;
});
document.getElementById('waMessageInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter') document.getElementById('waSendBtn').click();
});
