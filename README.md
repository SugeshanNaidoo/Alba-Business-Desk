# Social sync backend — Instagram, Facebook, TikTok

This lets the CRM pull real follower counts and post engagement from Meta
(Instagram + Facebook) and TikTok automatically, instead of typing numbers in
by hand. It's the same underlying pattern as your Alba Designs contact form:
small serverless functions on Vercel, no server to manage.

There are two ways to set this up. **Section A (recommended)** gives you a
real "Connect Instagram" button in the CRM and a daily automatic sync.
**Section B** is the older, simpler env-var-only approach from before — still
works, just requires you to manually regenerate tokens every couple of months
and click "Sync now" yourself.

**Why this is a separate backend at all:** the CRM itself is a static file
with no server. These platforms all require secret keys that can never live
in code that runs in a browser — anyone could open dev tools and steal them.
These functions hold the secrets server-side and only ever return numbers,
never the keys themselves.

---

## Section A — Real "Connect" buttons + scheduled sync (recommended)

### What you get
- A "Connect Instagram & Facebook" and a "Connect TikTok" button in the CRM's
  Settings, each of which sends you through that platform's real login/consent
  screen — no copying tokens by hand.
- A daily automatic sync, so numbers stay current even if nobody opens the
  CRM that day.

### Before you start
- Instagram must be a Business or Creator account linked to a Facebook Page
  you admin (Instagram app → Settings → Account type).
- You'll need a free Firebase project — if you already set one up for the
  CRM's Google sign-in / cloud sync, you can reuse the same one here.

### Step 1 — Give the backend its own Firestore access
Unlike the CRM's browser-side Firebase config (which only proves who's
signed in), this backend needs to read and write Firestore on its own:

1. Firebase console → your project → Project settings (gear icon) →
   Service accounts.
2. Click "Generate new private key" — downloads a JSON file.
3. Open that file, copy its entire contents, and paste it as a single-line
   string into the `FIREBASE_SERVICE_ACCOUNT` environment variable in Vercel.
   (Most text editors can join all lines into one — the exact formatting
   doesn't matter as long as it's valid JSON on one line.)

### Step 2 — Meta (Instagram + Facebook) app
1. developers.facebook.com → My Apps → Create App → "Business".
2. Add the **Instagram Graph API** and **Facebook Login for Business** products.
3. Facebook Login for Business → Settings → add this to "Valid OAuth Redirect URIs":
   `https://your-backend-domain.vercel.app/api/oauth-meta-callback`
4. Because you're only ever connecting your *own* accounts, this can stay in
   the app's Development Mode — just make sure your Meta account is listed
   as an Admin under App Roles → Roles. Full App Review is only needed if
   other people's accounts will connect to this app.
5. **App Review → Permissions and Features** — search for each of these and
   make sure each one shows as available to your app (there's usually an
   "Add" or a toggle per permission, even in Development Mode):
   `pages_show_list`, `pages_read_engagement`, `instagram_basic`,
   `instagram_manage_insights`. If a permission doesn't show an option to
   add it at all, your app may need its Instagram Graph API / Facebook Login
   for Business products re-checked — permissions tied to a product that
   isn't properly added get rejected wholesale, and Meta's error message
   often lists every requested scope as "invalid" even when only one or two
   are actually the problem, which is a common point of confusion.
6. From the app dashboard, copy the App ID and App Secret into
   `META_APP_ID` and `META_APP_SECRET`.

**If you still get "Invalid Scope" after checking the above:** double-check
you're using the code from this bundle, not a hand-edited copy — the scope
list intentionally excludes `instagram_manage_mentions` and
`business_management`, since both are commonly gated behind extra review and
aren't needed for the core follower/post sync. Mentions tracking simply won't
populate without the former; everything else works fine.

### Step 3 — TikTok app
This one takes longer than Meta — TikTok's approval process is slower, and
follower counts specifically need a business-tier scope that isn't always
granted immediately. Video engagement numbers work regardless.

1. developers.tiktok.com → create an app.
2. Add the **Login Kit** product, request scopes `user.info.basic`,
   `user.info.stats`, and `video.list`.
3. Set the redirect URI to:
   `https://your-backend-domain.vercel.app/api/oauth-tiktok-callback`
4. Copy the Client Key and Client Secret into `TIKTOK_CLIENT_KEY` and
   `TIKTOK_CLIENT_SECRET`.

### Step 4 — The rest of the environment variables
- `APP_BASE_URL` — where this backend is deployed, no trailing slash.
- `CRM_URL` — where the CRM (index.html) is hosted; the connect flow
  redirects back here when it's done.
- `CONNECT_SECRET` — make up any random string. This gates the "Connect"
  buttons so a stranger can't hit the URL and connect their own account to
  your backend.

### Step 5 — Deploy
Copy this whole folder's contents (`api/`, `vercel.json`, `package.json`)
into your existing Vercel project, alongside your contact-form function.
`npm install` will pull in `firebase-admin` from `package.json` on deploy.
If your project already has a `vercel.json`, merge the `crons` array into
it rather than overwriting the file.

### Step 6 — Connect, in the CRM
1. Settings → Social integrations → paste your backend's URL as the API base,
   and the same value you used for `CONNECT_SECRET`.
2. Click "Connect Instagram & Facebook" — you'll be sent to Meta's login,
   approve, and land back in the CRM connected.
3. Click "Connect TikTok" — same idea.
4. Each platform card in the Social tab now has a working "Sync now" button.

### Step 7 — Turn on the daily scheduled sync (optional)
1. Sign into the CRM with Google (if you haven't already) so your data is
   cloud-synced.
2. Settings → Account shows your Firebase UID once signed in — copy it into
   `CRM_OWNER_UID`.
3. That's it — `vercel.json` already registers the daily cron. Vercel
   auto-provisions `CRON_SECRET` for you; you don't set it yourself.

**Vercel's free (Hobby) plan only allows cron jobs to run once per day**, and
can't guarantee the exact minute (it'll fire sometime within the scheduled
hour). That's plenty for this — daily is the sensible cadence for follower
counts anyway. Paid plans allow more frequent schedules if you ever want that.

**One thing worth knowing:** the scheduled sync reads your whole workspace,
merges in fresh social data, and writes it back. If someone happens to be
actively editing the CRM in a browser tab at the exact moment it runs, last
write wins. Not a concern for a once-a-day sync on a small team, but worth
knowing.

---

## Section B — Env-var-only setup (simpler, more manual)

If you'd rather skip Firebase Admin and OAuth entirely, the sync functions
still fall back to plain environment variables if no connection is found in
Firestore:

- `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID`
- `FB_PAGE_ACCESS_TOKEN`, `FB_PAGE_ID`
- `TIKTOK_REFRESH_TOKEN` (plus `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`, needed either way)

Getting these values requires manually using the Graph API Explorer / TikTok's
OAuth flow yourself via curl and pasting the results in — no "Connect" button,
and Meta's token needs manual renewal roughly every 60 days. This still works
today from earlier setup and needs no changes if you're already using it —
it's just more hands-on than Section A.

---

## Section C — Billing (PayFast subscriptions)

This turns Alba Business Desk into something other businesses pay to use:
R1000/month, charged automatically every month from the card entered at
signup. Card details are entered on PayFast's own hosted page — they never
touch this backend or the CRM directly, so there's no PCI compliance burden
on your side.

### How it works
1. A signed-in user clicks "Subscribe" in the CRM → sent to
   `/api/billing-checkout`, which verifies who they are (their Firebase ID
   token) and redirects them into a signed PayFast payment form.
2. They pay on PayFast's page. PayFast redirects them back to the CRM
   either way (`?billing=success` or `?billing=cancelled`).
3. Separately — and this is the part that actually matters for security —
   PayFast sends a server-to-server notification (an "ITN") to
   `/api/billing-notify` confirming the payment. Only after that
   notification is validated does the account's subscription get marked
   active in Firestore. The redirect back to the CRM is just for the
   person's benefit; it's never trusted on its own to grant access.
4. Every month, PayFast automatically charges the same card and sends
   another ITN, keeping the subscription's `lastPaymentAt` current.

### Setup
1. Sign up at payfast.co.za as a merchant (or use sandbox.payfast.co.za for
   testing — no real account needed there).
2. From your PayFast merchant dashboard, copy your **Merchant ID** and
   **Merchant Key** into `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY`.
3. Under Settings → Security, set a **passphrase** (strongly recommended —
   without one, anyone who knows your merchant ID could forge a fake
   "payment successful" notification). Put the same value in
   `PAYFAST_PASSPHRASE`.
4. While testing, set `PAYFAST_SANDBOX=true` — this points everything at
   PayFast's sandbox instead of taking real payments. Switch it to `false`
   (or remove it) when you're ready to go live.
5. That's it for environment variables — `APP_BASE_URL` and `CRM_URL` from
   Section A are reused here too.

### Testing before going live
Use PayFast's sandbox card numbers (in their docs) with `PAYFAST_SANDBOX=true`
to run a full subscription through end to end — including waiting to confirm
the ITN actually lands on `/api/billing-notify` and flips the account to
`active` — before switching to real payments. A payment that "succeeds" on
PayFast's page but never fires or never validates the ITN is a customer who
paid but never gets access, which you want to catch in sandbox, not with a
real customer's money.

### Cancelling and account deletion
Both are in the CRM's Billing tab (separate from Settings) now:
- **Cancel subscription** calls PayFast's Subscriptions API to actually stop
  the recurring charge — not just a status flag on our side. If PayFast
  doesn't confirm the cancellation, nothing changes and the failure is
  shown, rather than silently marking it cancelled while the card keeps
  being charged.
- **Delete my account & all data** cancels any active subscription first,
  and only proceeds to delete the account's CRM data, billing records, and
  sign-in itself if that cancellation succeeds (or there was nothing to
  cancel). If cancellation fails, deletion is stopped entirely — better to
  have a leftover account than to lose the ability to trace an active charge
  back to anyone.
- Every completed payment is recorded individually (not just "most recent"),
  visible as a history list, each with a "Download statement" button that
  generates a dated statement document naming the account, payment date,
  reference, and amount.

**Test the cancel flow in sandbox too**, same reasoning as the payment flow
above — PayFast's Subscriptions API returns a plain 401 "Merchant
authorization failed" with no further detail if its request signature is
even slightly off, which several other integrations have run into. Confirm
a real sandbox subscription can actually be cancelled before relying on this
for a real customer.

### What this does NOT do yet
This section covers taking payments, tracking who's paid, cancelling, and
account deletion. It does not yet **enforce** that only paying accounts can
use the CRM — subscription status is fully tracked and visible, but the app
itself doesn't lock anyone out for not having paid. That's a deliberate next
step, not an oversight — ask if you want that built next.

## Operational notes

- **Rate limits**: daily sync is comfortably under everyone's limits. Don't
  wire "Sync now" to run automatically every few minutes.
- **Reach/impressions**: Instagram and Facebook don't return reach on the
  basic post-list endpoints — that needs a separate, more rate-limited
  insights call per post, so it's left blank here.
- **Mentions**: only Instagram's API can report these, and only with the
  `instagram_manage_mentions` permission. Facebook and TikTok don't expose
  mentions through any public API — manual logging in the CRM is the only
  option for those.
- **Multiple Facebook Pages**: the OAuth callback currently connects the
  first Page it finds. If you manage more than one Page, edit
  `oauth-meta-callback.js` to pick the right one from `pagesData.data`.
