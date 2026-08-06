// Shared helpers used across the backend: strict CORS, small cookie
// utilities used for OAuth CSRF protection, and normalizing configured
// base URLs.

// Strips any trailing slash(es) from an env-var URL before it's used to
// build a redirect_uri or similar — a trailing slash on APP_BASE_URL is a
// common, easy-to-miss cause of "Invalid redirect_uri" errors, since
// "https://x.com/" + "/api/oauth-instagram" produces a double slash that
// won't byte-for-byte match whatever's registered in the provider's
// dashboard, even though it looks identical at a glance.
function normalizeBaseUrl(url){
  return (url || '').trim().replace(/\/+$/, '');
}

// CORS is intentionally strict by default now: it only ever allows the
// specific origin(s) you configure, never a wildcard. Set ALLOWED_ORIGIN to
// your CRM's URL (comma-separate more than one if you host it in a couple
// of places, e.g. a preview + production domain). Falls back to CRM_URL if
// ALLOWED_ORIGIN isn't set, so there's always a real origin, never "*".
function setCors(req, res) {
  const configured = (process.env.ALLOWED_ORIGIN || process.env.CRM_URL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const requestOrigin = req && req.headers ? req.headers.origin : null;
  const allowOrigin = (requestOrigin && configured.includes(requestOrigin))
    ? requestOrigin
    : (configured[0] || '');
  if(allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.setHeader('Vary', 'Origin');
}

function parseCookies(req){
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if(idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx+1).trim();
    if(k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, { maxAgeSeconds = 600, httpOnly = true } = {}){
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if(httpOnly) parts.push('HttpOnly');
  parts.push('Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSeconds}`);
  const existing = res.getHeader('Set-Cookie');
  const next = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  next.push(parts.join('; '));
  res.setHeader('Set-Cookie', next);
}

module.exports = { setCors, parseCookies, setCookie, normalizeBaseUrl };
