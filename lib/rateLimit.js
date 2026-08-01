// A basic fixed-window rate limiter backed by Firestore, so repeated abuse
// of an endpoint (someone hammering the OAuth start URL, checkout, or the
// PayFast webhook target) gets slowed down rather than processed every time.
//
// This is deliberately simple rather than a dedicated rate-limiting service
// (like Upstash/Redis) — it adds a small Firestore read+write per checked
// request, which is fine at this app's scale, but isn't the lowest-latency
// option if this ever needs to handle serious traffic volume.

const { getDb } = require('./firebaseAdmin');

// Returns true if the request should be ALLOWED, false if it should be
// rejected as rate-limited. `key` should uniquely identify what's being
// limited, e.g. `checkout:${ip}` or `notify:${ip}`.
async function checkRateLimit(key, { limit = 20, windowSeconds = 60 } = {}){
  try{
    const db = getDb();
    const ref = db.collection('rate_limits').doc(key.replace(/[/\\]/g, '_'));
    const now = Date.now();

    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.exists ? doc.data() : null;
      const windowMs = windowSeconds * 1000;

      if(!data || (now - data.windowStart) > windowMs){
        tx.set(ref, { windowStart: now, count: 1 });
        return true;
      }
      if(data.count >= limit){
        return false;
      }
      tx.update(ref, { count: data.count + 1 });
      return true;
    });
  }catch(e){
    // If the rate limiter itself can't be reached, fail OPEN rather than
    // blocking legitimate traffic because of an infrastructure hiccup.
    console.error('Rate limit check failed (allowing request):', e.message);
    return true;
  }
}

module.exports = { checkRateLimit };
