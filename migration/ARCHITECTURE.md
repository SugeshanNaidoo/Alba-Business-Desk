# Alba Business Desk — Current Architecture

**Status:** as-built, before the multi-tenant migration.
**Data model version:** 1 (implicit — not yet recorded anywhere).
**Last audited:** 6 August 2026.

> **Collection rename (post-Phase 2).** `flowline_crm_users` →
> `albabusinessdesk_crm_users`, and localStorage `flowline_*` →
> `albabusinessdesk_*`. Renaming a Firestore collection does not move data,
> so both names coexist: the backend copies each workspace forward once on
> bootstrap (idempotent, non-destructive), the client falls back to the old
> name if that copy hasn't happened, and the old collection is frozen
> read-only rather than deleted. Paths below use the new name.

This document describes how the system works *today*. It is the reference
point for the migration described in `MIGRATION.md`. Nothing here is
aspirational — every claim was verified against the source.

---

## 1. Shape of the system

Static frontend (no build step) + Vercel serverless backend + Firebase.

```
Browser                          Vercel (Node)                Firebase
─────────                        ─────────────                ────────
index.html                       api/billing.js               Auth (Google)
js/*.js  (13 modules)            api/session.js               Firestore
  └─ global DATA object          api/calendar.js
     └─ localStorage             api/oauth-meta.js
     └─ Firestore (1 doc)        api/oauth-instagram.js
                                 api/oauth-tiktok.js
                                 api/social-sync.js
                                 api/whatsapp.js
                                 lib/*.js (11 helpers)
```

8 serverless functions. Vercel Hobby allows 12 — **4 spare**, which is a real
constraint on the migration (see `MIGRATION.md` §6).

---

## 2. The `DATA` object

**Defined:** `js/core.js:259` — `let DATA = loadData();`

A single module-scope global, populated **synchronously at script parse
time**, before Firebase Auth has resolved. Every render function reads from
it directly.

### Top-level keys (from `defaultData()`, core.js:93)

| Key | Type | Notes |
|---|---|---|
| `settings` | object | `workspaceName` only |
| `stages` | string[] | pipeline stage names, order matters |
| `contactStatuses` | object[] | `{id, name, category}` |
| `leadSources` | object[] | `{id, name}` |
| `companies` | object[] | |
| `customFieldDefs` | `{contact:[], deal:[]}` | field definitions |
| `teamMembers` | object[] | **local only** — not Firebase users |
| `lostReasons` | object[] | |
| `salesTargets` | object[] | `{id, memberId, period, amount, startDate}` |
| `contacts` | object[] | |
| `deals` | object[] | each embeds its own `stageHistory[]` |
| `tasks` | object[] | |
| `activity` | object[] | **capped at 60 entries** (core.js:265) |
| `socialPlatforms` | object[] | user-declared platform cards |
| `socialSnapshots` | object[] | follower counts over time |
| `socialPosts` | object[] | synced + manual |
| `socialMentions` | object[] | |

### Critical property

`teamMembers` are **plain strings in an array**, not Firebase users. They exist
so a deal can be "assigned to" someone for reporting. There is no auth, no
uid, no login associated with them. This matters: the migration's
`members/{uid}` collection is a *different concept* and must not be conflated
with `DATA.teamMembers`.

---

## 3. Persistence

### `loadData()` — core.js:201
```
localStorage[albabusinessdesk_crm_data_v1] → migrateData() → DATA
                                   ↓ (if absent)
                                   defaultData()
```

`migrateData()` (core.js:210) is a **schema-shim for older local payloads** —
it backfills keys added in past releases. It is unrelated to the multi-tenant
migration and should not be confused with it.

### `saveData(d)` — core.js:252
```
localStorage.setItem(whole object)
  ↓ if signed in
debounce 600ms → pushCloudData()
```

### `pushCloudData()` — account.js:308
```js
cloudDb.collection('albabusinessdesk_crm_users').doc(cloudUser.uid).set({
  payload: JSON.stringify(DATA), updatedAt: Date.now()
})
```

**The entire workspace is one JSON string in one Firestore document.**
This is the architecture being replaced.

### `pullCloudData()` — account.js:329
On sign-in, reads that doc and replaces `DATA` wholesale. If the doc does not
exist, it deliberately starts from `defaultData()` rather than uploading
whatever is in localStorage — a shared-device safety measure. **Preserve this
behaviour.**

---

## 4. Call-site inventory

### `saveData()` — 57 call sites

| File | Count | Lines |
|---|---|---|
| `settings.js` | 32 | 37, 46, 53, 75, 82, 90, 97, 111, 119, 126, 140, 151, 158, 172, 183, 190, 211, 214, 217, 220, 226, 233, 258, 266, 274, 282, 289, 294, 300, 417, 462, 545 |
| `social.js` | 8 | 135, 366, 372, 394, 448, 454, 493, 499 |
| `contacts.js` | 5 | 137, 144, 215, 221, 262 |
| `pipeline.js` | 4 | 57, 146, 181, 187 |
| `account.js` | 3 | 285, 333, 342 |
| `tasks.js` | 3 | 55, 100, 106 |
| `core.js` | 1 | 207 (inside `loadData`) |

### `DATA` write mutations — 36 sites

| File | Lines |
|---|---|
| `contacts.js` | 134, 142, 209, 220 |
| `core.js` | 263, 265 (activity log) |
| `pipeline.js` | 178, 186 |
| `settings.js` | 45, 52, 89, 96, 118, 125, 149, 150, 157, 182, 189, 225, 232, 533 |
| `social.js` | 111, 116, 127, 363, 364, 371, 392, 445, 453, 490, 498 |
| `tasks.js` | 48, 97, 105 |

`dashboard.js` and `reports.js` **read only** — no mutations. They can stay
untouched through the whole migration provided `DATA` remains populated.

### `loadData()` — 1 call site
`core.js:259`. Nothing else calls it.

---

## 5. Firestore paths

| Path | Document shape | Written by | Client rules |
|---|---|---|---|
| `albabusinessdesk_crm_users/{uid}` | `{payload: string, updatedAt: number}` | **Client SDK** | read/create own; update requires active sub |
| `subscriptions/{uid}` | `{status, payfastToken, lastPaymentAt, lastAmount, pfPaymentId, updatedAt}` | Admin | denied |
| `subscriptions/{uid}/payments/{pfPaymentId}` | `{amount, date, pfPaymentId, status}` | Admin | denied |
| `social_connections/{uid}_{platform}` | raw OAuth tokens + metadata | Admin | denied |
| `whatsapp_messages/{auto}` | `{uid, contactPhone, direction, body, waMessageId, timestamp, status}` | Admin | denied |
| `whatsapp_message_status/{waMessageId}` | `{uid, status, updatedAt}` | Admin | denied |
| `whatsapp_phone_lookup/{phoneNumberId}` | `{uid, updatedAt}` | Admin | denied |
| `audit_logs/{auto}` | `{event, uid, detail, ip, timestamp}` | Admin | denied |
| `rate_limits/{key}` | counter | Admin | denied |

### The single most important fact

**The client SDK touches exactly one path** (`albabusinessdesk_crm_users/{uid}`,
account.js:308 and :329). Everything else is Admin SDK behind session-verified
API routes.

Consequence: the security-rules rewrite is far smaller than the target
architecture suggests, because most collections are already `allow read, write:
if false` and will stay that way.

`social_connections` uses a **composite document key** (`{uid}_{platform}`)
rather than a subcollection — deliberately, so the wildcard rule
`match /social_connections/{platform}` covers every platform without
per-platform rules.

---

## 6. Identity and session

There is **no `users/{uid}` document.** Identity is Firebase Auth alone.

```
Google popup (client SDK)
  → idToken
  → POST /api/session?action=login   (Authorization: Bearer <idToken>)
  → admin.auth().createSessionCookie(5 days)
  → Set-Cookie: abd_session (HttpOnly, Secure, SameSite=Lax)
              + abd_csrf   (readable, double-submit)
```

Every backend route derives `uid` from `verifySessionCookie()`
(`lib/session.js`). Mutations additionally require the CSRF header to match
the cookie. **`uid` is the universal tenant key today.**

---

## 7. Billing — and the `m_payment_id` coupling

```
Checkout:  billing.js:46   m_payment_id = decoded.uid   ──┐
                                                          │  PayFast stores this
ITN:       billing.js:239  const uid = body.m_payment_id ─┘  against the subscription
                           → subscriptions/{uid}.set({status:'active', payfastToken, …})
```

**PayFast permanently associates the Firebase `uid` with the subscription.**
Every future renewal ITN — months or years later — returns that same `uid`.

Subscription status becomes `active` *only* via a verified ITN. The client
cannot set it (rules deny all writes to `subscriptions/`).

### Downstream dependencies on `subscriptions/{uid}`

1. `firestore.rules` → `isSubscribed(userId)` gates writes to
   `albabusinessdesk_crm_users/{userId}`.
2. `lib/subscriptionCheck.js` → gates every integration action server-side.
3. `api/social-sync.js:152` → the daily cron enumerates
   `subscriptions where status == 'active'` to find workspaces to sync.
4. `api/billing.js` → status, history, cancel, delete-account.

**This is the highest-risk area of the migration.** See `MIGRATION.md` §2.

---

## 8. Integrations

| Integration | Token location | Client exposure |
|---|---|---|
| Facebook | `social_connections/{uid}_meta` | none |
| Instagram | `social_connections/{uid}_instagram` | none |
| TikTok | `social_connections/{uid}_tiktok` | none |
| Google Calendar | `social_connections/{uid}_google_calendar` | none |
| WhatsApp | `social_connections/{uid}_whatsapp` | none |

All five already satisfy the "no raw tokens on the client" requirement. The
frontend only ever receives connection *status* plus display metadata
(page name, username, display name, calendar email, phone number).

### Google Calendar stores no events

Only the refresh token is persisted. Events are fetched live from Google on
each Calendar tab view and held in `calendarEventsCache`
(`js/scheduling.js:8`) — a browser variable that dies on refresh. Scopes
requested: `calendar.events`, `userinfo.email` (nothing more).

### WhatsApp has no conversation grouping

Messages are flat documents filtered by `(uid, contactPhone)` at query time.
`whatsapp_phone_lookup` is a reverse index the webhook needs to resolve an
inbound message to a tenant **without** requiring a composite index — the
webhook must respond fast and cannot afford a slow query.

---

## 9. Security posture (all verified present)

- HttpOnly session cookies; CSRF double-submit on every mutation.
- OAuth `state` in a short-lived HttpOnly cookie, validated on callback, for
  all four OAuth flows.
- Strict CORS — no wildcard; `ALLOWED_ORIGIN` required.
- Firestore-backed per-IP rate limiting on every route.
- PayFast ITN: signature + source-IP + postback validation.
- WhatsApp webhook: HMAC-SHA256 over the **raw** request body
  (`api/whatsapp.js` reads the stream directly — parsed-then-reserialised JSON
  would not match).
- Subscription gating enforced in Firestore rules *and* server-side, not just
  in the UI.
- 30-minute inactivity auto-signout.

**Rule for the migration: none of the above may weaken.**

---

## 10. Security-rule constraints that shape the target design

1. **Rules cannot list a subcollection.** Membership must live at a
   deterministic path — `organisations/{orgId}/members/{uid}` — so a rule can
   `exists()` it directly.
2. **10-document read limit per rule evaluation.** Current rules already spend
   one `get()` on `isSubscribed()`. A membership check costs `exists()` +
   `get()` for the role. Role must be read **once** from the member doc, not
   chained through the org doc.
3. **`get()` in rules is billed.** Every gated write costs extra reads. Keep
   the role on the member document so one read answers both "are they a
   member" and "what may they do".

---

## 11. Known gaps (pre-existing, not introduced by the migration)

- No `users/{uid}` profile document.
- No organisation concept — `uid` *is* the tenant.
- `DATA.activity` is capped at 60 entries; older history is discarded.
- `DATA` is loaded at parse time, before auth resolves, so the first render
  always shows local/default data briefly.
- Firestore payload doc is capped at 900 KB by rule (Firestore's own limit is
  1 MB) — a large workspace will eventually hit this. **This is the concrete
  scaling failure the migration exists to fix.**
