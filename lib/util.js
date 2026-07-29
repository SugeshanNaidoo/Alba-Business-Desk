// Shared helper used by every sync function.
// ALLOWED_ORIGIN should be the domain your CRM is hosted on (e.g. https://your-crm.vercel.app).
// Leaving it unset falls back to '*', which is fine while you're testing but worth
// tightening once this is live, so random sites can't call your endpoints.
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
module.exports = { setCors };
