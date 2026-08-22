// Organisation context for the browser.
//
// Establishes which workspace the signed-in user is working in and what their
// role is. There is no migration or legacy state: the application is
// organisation-native.

let ORG_CONTEXT = null;
let orgContextReady = false;
let orgContextError = null;   // surfaced in the UI when bootstrap fails

/* Creates or resolves the user's organisation. Idempotent server-side, so it
   is safe to call on every sign-in. */
async function initOrgContext(){
  try{
    const res = await fetch(`${BACKEND_BASE}/api/organisation?action=bootstrap`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    const data = await res.json();
    if(!res.ok){
      orgContextError = `${res.status}: ${data.error || 'Unknown error'}`;
      console.error('Organisation bootstrap failed:', orgContextError);
      ORG_CONTEXT = null;
      return null;
    }
    orgContextError = null;
    ORG_CONTEXT = {
      orgId: data.orgId,
      role: data.role,
      organisationName: data.organisationName || ''
    };
    return ORG_CONTEXT;
  }catch(err){
    orgContextError = `Could not reach /api/organisation (${err.message}). Is the backend deployed?`;
    console.error(orgContextError);
    ORG_CONTEXT = null;
    return null;
  }finally{
    orgContextReady = true;
  }
}

function currentOrgId(){ return ORG_CONTEXT ? ORG_CONTEXT.orgId : null; }
function currentRole(){ return ORG_CONTEXT ? ORG_CONTEXT.role : null; }

/* Role gate for UI affordances. NEVER the only check — every sensitive action
   is also enforced server-side and in the Firestore rules. */
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
/* True once the organisation context has resolved and a role is known.

   UI gates MUST check this before restricting anything. Treating "not loaded
   yet" as "not permitted" is what made an owner see a read-only workspace:
   the billing panel asked for the role before bootstrap had returned it, got
   false, and hid the controls permanently. A restrictive default is only
   safe if it is read AFTER it resolves. */
function roleKnown(){ return !!(ORG_CONTEXT && ORG_CONTEXT.role); }

function roleAtLeast(minimum){
  const r = currentRole();
  if(!r) return false;
  return (ROLE_RANK[r] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}

/* Convenience for UI gates: "am I allowed, or do we not know yet?"
   Returns true while unknown, so nothing is disabled prematurely — the
   server and Firestore rules remain the actual enforcement. */
function roleAllows(minimum){
  return !roleKnown() || roleAtLeast(minimum);
}

/* ---- Team management -----------------------------------------------------
   Every one of these is authorised server-side; the role checks in the UI
   only decide what to show. */
async function _orgPost(action, body){
  const send = () => fetch(`${BACKEND_BASE}/api/organisation?action=${action}`, {
    method:'POST', credentials:'include',
    headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify(body || {})
  });
  const res = (typeof repairSessionAndRetry === 'function')
    ? await repairSessionAndRetry(send) : await send();
  const data = await res.json().catch(()=>({}));
  return { ok: res.ok, status: res.status, data };
}

async function listMembers(){
  try{
    const send = () => fetch(`${BACKEND_BASE}/api/organisation?action=members`, { credentials:'include' });
    const res = (typeof repairSessionAndRetry === 'function')
      ? await repairSessionAndRetry(send) : await send();
    if(!res.ok) return null;
    return await res.json();
  }catch(err){ console.error('Could not load the team list:', err); return null; }
}
const inviteMember   = (email, role) => _orgPost('invite', { email, role });
const resendInvite   = (email)       => _orgPost('resend-invite', { email });
const setMemberRole  = (uid, role)   => _orgPost('set-role', { uid, role });
const removeMember   = (uid, email)  => _orgPost('remove-member', { uid, email });
