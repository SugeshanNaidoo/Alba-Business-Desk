# Alba Business Desk — Architecture & Security

Organisation-based multi-tenant SaaS. No legacy storage, no migration layer.

---

## Firestore structure

```
users/{uid}                        profile, activeOrganisationId,
                                   organisationIds[] (CACHE — never authoritative)

organisations/{orgId}              name, ownerId, seatLimit,
                                   subscription{} (backend-mirrored)

organisations/{orgId}/members/{uid}          ← AUTHORITATIVE membership
    role   ∈ owner | admin | member | viewer
    status ∈ active | invited | removed

organisations/{orgId}/config/workspace       ← one doc: stages, statuses,
                                               lead sources, custom fields,
                                               team roster, targets, AUTOMATIONS

organisations/{orgId}/contacts|companies|deals|tasks|activities/{id}
organisations/{orgId}/socialAccounts|socialSnapshots|socialPosts|socialMentions/{id}
organisations/{orgId}/calendarEvents|files|auditLogs/{id}
```

### Top-level, deliberately outside `organisations/`

| Collection | Reason |
|---|---|
| `subscriptions/{ownerUid}` | PayFast binds the subscription to a uid via `m_payment_id`. **Source of truth for entitlement.** |
| `social_connections/{orgId}_{platform}` | Raw OAuth tokens. Kept outside `organisations/` so **no membership rule can ever expose them** — physical separation, not just a rule. |
| `pendingInvites/{sha256(email)}` | Invitations for people without an account. Email hashed so it can't be harvested as an address list. |
| `rate_limits`, `audit_logs` | Per-IP / server-only. |

---

## Permission matrix (enforced in rules AND server-side)

| Capability | owner | admin | member | viewer |
|---|:--:|:--:|:--:|:--:|
| Read CRM data | ✅ | ✅ | ✅ | ✅ |
| Create/update/delete CRM records | ✅ | ✅ | ✅ | ❌ |
| Workspace config (stages, custom fields, **automations**) | ✅ | ✅ | ❌ | ❌ |
| Invite / remove people | ✅ | ✅ | ❌ | ❌ |
| Change roles | ✅ | ❌ | ❌ | ❌ |
| Connect / disconnect integrations | ✅ | ✅ | ❌ | ❌ |
| **Billing: subscribe, cancel, delete account** | ✅ | ❌ | ❌ | ❌ |

**Entitlement is the ORGANISATION's** — `orgIsSubscribed()` resolves `ownerId`
and checks `subscriptions/{ownerUid}`. A member on a paid workspace can work;
nobody can write on an unpaid one. The `organisations/*.subscription` mirror is
**not** trusted by the rules.

**Read budget per CRM write:** 3 documents (member, org, subscription) against
Firestore's limit of 10.

---

## Audit findings — this round

### FINDING 1 (high) — billing was not role-gated

`?action=cancel` and `?action=delete-account` verified the session but never
the role. **Any signed-in member could cancel the organisation's subscription
or delete the entire account.** The session proved who they were; nothing
checked what they were allowed to do.

Fixed: all three billing actions (checkout, cancel, delete) are owner-only.
Checkout matters too — PayFast binds the subscription to whoever checks out,
so a member subscribing would attach billing to the wrong person.

### FINDING 2 (medium) — social connects were not role-gated

Disconnect and calendar-connect required admin; the three OAuth *connect*
routes did not. Any member could attach a social account to the workspace.
Fixed: admin+ on all three, matching the rest.

### FINDING 3 (medium) — workspace config writable by members

`config/workspace` holds stages, custom fields, targets and **automations**.
It was `validCrmWrite` (member+), so a member could rewrite pipeline stages
for everyone or create automations acting on the whole workspace. Now admin+.

### FINDING 4 — onboarding dismissal was workspace-wide

Stored in the shared config document, so one person dismissing the checklist
hid it for the entire team — and, after Finding 3, a member could not dismiss
it at all. Moved to per-user `localStorage`, which is what it always should
have been.

The sync layer now advances its config baseline on `permission-denied` and
warns once, rather than retrying a rejected write on every save — the same
failure mode previously found with append-only activities.

---

## Controls verified

| Control | Status |
|---|---|
| Session auth on all 8 routes | ✅ |
| Rate limiting on all 8 routes | ✅ |
| CSRF on every state-changing action | ✅ |
| OAuth `state` cookie on all 4 redirect flows | ✅ |
| Role checks on every privileged action | ✅ |
| Subscription enforced in rules and server-side | ✅ |
| Write size/shape validation (13 collections) | ✅ |
| Activities append-only | ✅ |
| `members` / `pendingInvites` server-write-only | ✅ |
| OAuth tokens unreachable from browser | ✅ |
| No unscoped cross-tenant queries | ✅ |
| No wildcard CORS | ✅ |
| Cookies HttpOnly + Secure + SameSite=Lax | ✅ |
| PayFast ITN: signature + source IP + postback | ✅ |
| Catch-all deny | ✅ |
| No undefined variables in any handler | ✅ (scripted scan) |

---

## Features

**Team management** — invite by email (Resend), remove (soft: `status:'removed'`,
history preserved), change role, pending invites, resend. Seat limit 4,
checked at invite **and** accept time.

**Automations** — WHEN/THEN rules in config. 5 triggers, 2 actions,
`{{name}}` substitution, depth guard against self-triggering chains.
Evaluated client-side: they fire when someone performs the action, not on a
schedule. Stated in the UI and the Terms.

**Onboarding checklist** — completion **derived from real data**, never
stored flags, so it cannot drift. Integration status fetched once, and only
while the checklist is visible.

**Activity pagination** — 50 on load, "load older" pages 50 more,
`loadActivityFor()` fetches a record's full timeline on demand. Cut sign-in
reads ~55%.

---

## Residual risks — accepted, documented

1. **`limit(5000)` per collection** on load; hitting it warns rather than
   silently truncating. Revisit past ~5,000 records in one collection.
2. **Firestore rules cannot rate-limit.** A subscribed member could write in
   a loop and drive up cost. API routes are limited; direct SDK writes are
   not. Fine while all members are trusted.
3. **Automations are client-side.** They do not run while the app is closed.
4. **No third-party penetration test.** All of the above is self-audit.
5. **Vercel Hobby is non-commercial** per their ToS; this is a paid product.


---

# Full audit — findings and fixes

## FINDING A (medium) — stored XSS via admin-editable names

Contact tags and pipeline stage names are **user-editable configuration**, and
five places rendered them raw into `innerHTML`:

```
contacts.js  ${c.tag}     × 2   (table cell and contact drawer)
contacts.js  ${d.stage}          (related deals in the drawer)
contacts.js  ${g.label}          (group filter chips)
reports.js   ${t.period}         (sales target rows)
```

An admin naming a contact status `<img src=x onerror=…>` would have executed
that markup for every user viewing any contact carrying the tag. Low
likelihood — it needs an admin — but it is stored XSS against colleagues, and
in a multi-tenant product the "trusted admin" assumption is exactly what
should not be relied on.

All five now pass through `escapeHtml()`.

**Verified not vulnerable:** every `logActivity()` string (escaped at render
via `escapeHtml(activityText(a))`), all `textContent` assignments (safe by
construction), `platformColor`/`platformIcon` (fixed maps with safe
defaults), and the settings editors (already escaped).

## FINDING B (low/medium) — four mutating endpoints unrate-limited

`resend-invite`, `set-role`, `remove-member` and `settings` had role and CSRF
checks but no rate limit.

`resend-invite` is the one that matters: it sends email through Resend, so an
admin could have been used to spam an address, burning quota and reputation.
It now has the **strictest limit in the codebase** — 10 per 10 minutes,
deliberately tighter than invite itself.

`context` and `members` remain unlimited: read-only and cheap.

## Verified clean

* No handler references an undefined variable (scripted AST-ish scan).
* No viewer can write through any rule path — every write is
  `validCrmWrite` (member+) or `isOrgAdmin`.
* Automations fire **before** `saveData()`, so records they create persist in
  the same write. Confirmed for all four trigger sites.
* `deal.won` cannot double-fire: the create path and `recordStageChange()`
  are mutually exclusive.
* `recordStageChange()` returns early when the stage is unchanged, so
  re-saving a deal does not re-trigger stage automations.

## Full control matrix

| Control | Coverage |
|---|---|
| Session auth | 8/8 routes |
| Rate limiting | 8/8 routes; all mutating actions |
| CSRF | every state-changing action |
| OAuth `state` cookie | 4/4 redirect flows |
| Role checks | every privileged action |
| Subscription | rules + server-side, org-owner-based |
| Output escaping | all user-editable text |
| Write size/shape validation | 13 collections |
| Append-only activities | ✅ |
| Server-write-only: members, pendingInvites, tokens, audit logs | ✅ |
| Cross-tenant isolation | 0 unscoped queries |
| Cookies | HttpOnly + Secure + SameSite=Lax |
| PayFast ITN | signature + source IP + postback |
| Catch-all deny | ✅ |


---

# UI restructure + role-gate bug

## BUG — an owner saw a read-only workspace

`handleAuthChange()` calls `refreshBilling()` **before** `initOrgContext()`,
so the billing panel asked `roleAtLeast('owner')` while `ORG_CONTEXT` was
still `null`. That returned `false`, the owner-only controls were hidden, and
nothing ever re-ran the check — so the delete button stayed missing and the
settings controls stayed disabled for the rest of the session.

**This is the third instance of the same bug class in this codebase:**
a restrictive default read before it resolves. The first was
`SUBSCRIPTION_ACTIVE` (false view-only banner); the second was
`SUBSCRIPTION_KNOWN`; this is the third.

### Fix

* `roleKnown()` — has the role actually resolved?
* `roleAllows(min)` — **permissive while unknown**, so nothing is disabled
  prematurely. UI gates use this; `roleAtLeast()` stays strict for logic that
  genuinely needs a definite answer.
* `applyRoleGates()` runs immediately after `initOrgContext()` and re-applies
  every role-dependent gate.
* The settings gate is now **reversible** — it re-enables controls when the
  role turns out to permit them, rather than disabling permanently.

### Rule for future gates

> A restrictive default is only safe if it is read after it resolves.
> Either resolve before anything reads it, or make "unknown" permissive in
> the UI and rely on the server for enforcement — which is where enforcement
> belongs anyway.

## Missing controls are now explained

A non-owner previously saw the billing danger zone with the delete button
simply absent. It now shows: *"Only the workspace owner can cancel the
subscription or delete the account."* The settings notice names the actual
role too. Silent absence reads as a bug; a stated reason reads as a rule.

## Restructure

* **People with access** moved from Settings → Sales into its own
  **Settings → Team** section.
* **Automations** promoted from a settings panel to a **top-level tab**, and
  its UI moved from `settings.js` into `automations.js` — the tab and the
  engine that powers it now live in the same module.
