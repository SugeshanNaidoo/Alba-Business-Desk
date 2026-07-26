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
5. From the app dashboard, copy the App ID and App Secret into
   `META_APP_ID` and `META_APP_SECRET`.

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
