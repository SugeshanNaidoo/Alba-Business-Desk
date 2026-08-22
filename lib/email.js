// Transactional email via Resend (https://resend.com).
//
// Uses the REST API directly rather than the SDK — the backend has no npm
// dependencies beyond firebase-admin, and one fetch call is not worth adding
// a package for.
//
// DESIGN: sending is best-effort and NEVER blocks the operation that
// triggered it. An invitation is a Firestore record; the email is a courtesy
// notification. If Resend is down, misconfigured, or unpaid, the person is
// still invited and can still join — the UI just tells the truth about
// whether a message went out.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function isConfigured(){
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* Returns { sent, reason }. Never throws — callers treat email as optional. */
async function sendEmail({ to, subject, html, text, replyTo }){
  if(!isConfigured()){
    return { sent:false, reason:'not_configured' };
  }
  try{
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,           // must be on a domain verified in Resend
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if(!res.ok){
      const body = await res.text().catch(()=> '');
      console.error('Resend rejected the message:', res.status, body);
      return { sent:false, reason:`http_${res.status}` };
    }
    return { sent:true };
  }catch(err){
    console.error('Could not reach Resend:', err.message);
    return { sent:false, reason:'network' };
  }
}

/* Invitation to join a workspace.

   Deliberately plain: no tracking pixels, no marketing chrome, and the only
   link is the app's own sign-in page. Invitations are authenticated by the
   recipient's Google account matching the invited address — the email itself
   carries no token, so forwarding it grants nobody anything. */
async function sendInviteEmail({ to, organisationName, inviterName, role, appUrl }){
  const org = escapeHtml(organisationName || 'a workspace');
  const who = escapeHtml(inviterName || 'A colleague');
  const url = appUrl || process.env.CRM_URL || '';
  const roleLabel = { admin:'an admin', member:'a member', viewer:'a viewer' }[role] || 'a member';

  const subject = `${who} invited you to ${organisationName || 'Alba Business Desk'}`;

  const text = [
    `${who} has invited you to join ${organisationName || 'a workspace'} on Alba Business Desk as ${roleLabel}.`,
    '',
    `Sign in here with this email address to join: ${url}`,
    '',
    'You will need to sign in with the Google account matching this address.',
    'If you were not expecting this invitation, you can ignore it — no account is created until you sign in.'
  ].join('\n');

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1D1D1F;line-height:1.55;">
    <h1 style="font-size:19px;font-weight:650;margin:0 0 16px 0;">You've been invited to ${org}</h1>
    <p style="margin:0 0 14px 0;font-size:15px;">
      ${who} has invited you to join <strong>${org}</strong> on Alba Business Desk as ${roleLabel}.
    </p>
    <p style="margin:0 0 24px 0;font-size:15px;">
      Sign in with <strong>this email address</strong> to join.
    </p>
    <p style="margin:0 0 24px 0;">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;background:#0071E3;color:#ffffff;text-decoration:none;
                padding:11px 22px;border-radius:8px;font-size:15px;font-weight:560;">
        Open Alba Business Desk
      </a>
    </p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#6E6E73;">
      You'll need to sign in with the Google account matching this address.
    </p>
    <p style="margin:0;font-size:13px;color:#6E6E73;">
      If you weren't expecting this, you can ignore it — nothing happens until you sign in.
    </p>
    <hr style="border:0;border-top:1px solid #E5E5E7;margin:24px 0 12px 0;">
    <p style="margin:0;font-size:12px;color:#8E8E93;">
      Alba Business Desk, a product of Alba Designs
    </p>
  </div>`;

  return sendEmail({ to, subject, html, text });
}

module.exports = { sendEmail, sendInviteEmail, isConfigured };
