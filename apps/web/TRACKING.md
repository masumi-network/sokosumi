# Analytics & consent

How Sokosumi measures its funnel, and how consent gates it. The same design
runs on the marketing site (`sokosumi-landing`) — this doc and the one there
describe the two halves of one system.

## The four layers

```text
USER
  │
  ▼
🍪  Cookie banner            "May I use analytics / marketing cookies?"
  │   (self-built, no CMP)
  ▼
🏷️  Google Tag Manager       one container, GTM-N7GC8SFT
  │   (the dispatcher)         spans sokosumi.com AND app.sokosumi.com
  ▼
📊  GA4                       one property, G-G4BW0XC76M
  │   (store + analyse)        + Google Ads AW-16455471438
  ▼
Reports · funnels · user paths · conversions
```

Vercel Analytics + Speed Insights run separately
(`components/analytics/client-analytics.tsx`) for traffic and web-vitals.
They are **not** part of this pipeline and **not** gated by `sokosumi_consent`
— `ClientAnalytics` mounts them on every page regardless of the banner.

**One container, one property, both domains.** The marketing site and the app
load the *same* GTM container and feed the *same* GA4 property, so a visit that
starts on a landing page and ends as an active, paying user is a single journey
in one place. GA4 cross-domain measurement links `sokosumi.com` ↔
`app.sokosumi.com` so it is one session, not two.

## Consent (Google Consent Mode v2, Advanced)

Google tags (`GoogleTagManager`, `GoogleAnalytics`) load whenever their public
IDs are set. Consent Mode defaults every ad/analytics **storage** signal to
`denied`, so GA4/Ads cookies are not written until the visitor grants
analytics or marketing. Denied tags can still send cookieless pings — that is
Advanced Consent Mode, not a hard block. Hard-blocking (render tags only after
a grant) is a separate privacy-posture change.

This guarantee is Google storage only. Vercel Analytics / Speed Insights are
outside it; see above.

- `components/analytics/consent-mode-init.tsx` runs **before** GTM (a
  `beforeInteractive` script) and sets every ad/analytics signal to `denied`.
  It also re-applies a previously stored choice immediately.
- `components/analytics/cookie-banner.tsx` is the banner. On a choice it writes
  the cookie and flips Consent Mode (`lib/analytics/consent.ts`).
- The choice lives in one cookie, **`sokosumi_consent`**, scoped to
  `.sokosumi.com`, so consenting on either domain covers both. Shape:

  ```json
  { "necessary": true, "analytics": true, "marketing": false, "ts": 0, "v": 1 }
  ```

- Categories → Consent Mode signals:

  | Category   | Signals set to granted                                            |
  |------------|-------------------------------------------------------------------|
  | necessary  | always on (`functionality_storage`, `security_storage`)           |
  | analytics  | `analytics_storage`                                               |
  | marketing  | `ad_storage`, `ad_user_data`, `ad_personalization`               |

- Consent can be changed anytime: call `openConsentPreferences()` (from
  `cookie-banner.tsx`) from a "Cookie settings" control.

## Events

GA4 records `page_view` on every route by itself — no code. On top of that we
push a small set of business events to the dataLayer. In this app they all go
through **`lib/gtm-events`** (`fireGTMEvent.*`, which wraps `sendGTMEvent`).
Consent Mode gates whether GTM forwards them to GA4/Ads.

| Event                 | Fires when…                                    | Where |
|-----------------------|------------------------------------------------|-------|
| `sign_up` `{provider}`| account created (`credential` from the form; social from the callback page) | `signup/components/form.tsx`, `components/social-auth-callback.tsx` |
| `login` `{provider}`  | signed in. Credential, social and magic-link fire on `/auth/callback/signin` after the full page load. Passkey fires in `social-buttons.tsx` before `router.replace` | `components/social-auth-callback.tsx`, `components/social-buttons.tsx` |
| `message_start` `{room_id}` | **a coworker DM is started** (first send per room) | `app/(app)/chat/hooks/use-coworker-direct-room-stream.ts` |
| `begin_checkout` `{plan?, seats?}` | Stripe checkout opened — credits/coupon (no params) and subscription upgrade (`plan`, org `seats`) | `components/credits/*-form.tsx`, `components/billing/*-subscription-section.tsx` |
| `purchase` `{transaction_id, value, currency, items}` | **a credit / coupon purchase succeeds** (Stripe returns with `session_id`). Subscription checkouts return with `status=success` only and do **not** fire `purchase` yet — see below | `components/billing/purchase-tracker.tsx` |
| `view_agent`, `view_credits`, `view_register_area`, `view_login_area`, `register_form_start`, `login_area_form_start`, `doi_confirmed` (defined, not yet fired — no call site) | funnel context | various |
| `consent_status` `{consent_analytics, consent_marketing}` | cookie choice made (banner) **and** on every full page load when the cookie already exists (`consent-mode-init.tsx`). Not re-pushed on SPA route changes — see [Why events go missing](#why-events-go-missing) | banner, `consent-mode-init.tsx` |
| `set_user_id` `{user_id}` | login state resolves (and on logout, null) | `components/analytics/analytics-user-id.tsx` |

Marketplace app Hire (`agent_hired` / `use-job-submission`) was removed with
SOK-805. Job starts via Hermes/Coworker/Core API are not tracked as a web GTM
conversion event yet.

The two the business cares about most map cleanly:

- **Starting direct messages** → `message_start`
- **Subscribing** → `purchase` (with `begin_checkout` as the step before)

Mark `sign_up` and `purchase` as **key events** (conversions) in GA4; add
`message_start` if you want it as a conversion too.
Drop any GTM conversion that still keys on `agent_hired`.

### Why events go missing

Lessons from the Aug 2026 GA4 audit — keep these in mind when adding events.

- **Better Auth hard-redirects on credential success.** `signIn.email` with a
  `callbackURL` makes the Better Auth client set `window.location.href` inside
  its fetch hook, *before* the caller's code after `await` runs. A
  `fireGTMEvent.*` placed after such a call is dead code (GA4 showed 0
  credential logins against 145 `login_area_form_start`). Magic-link submit
  only sends the email — the user stays on the form. The hard navigation is
  the verify GET → `callbackURL`. Fire success events on the page that
  full-page load lands on — that is what `/auth/callback/signin?provider=…`
  is for. Social sign-in already worked this way; credential and magic-link
  now use it too. Passkey has no Better Auth hard redirect, so it fires in
  place before `router.replace`.
- **Hard navigations after a push are a race.** `begin_checkout` is pushed and
  then `window.location.href = stripeUrl` runs on the next line. GA4 sends via
  `sendBeacon`, so it mostly survives, but push *before* navigating, never after.
- **GTM trigger groups fire once per page load.** Every GA4 event tag in the
  container is gated by a trigger group `consent_status & <event>`. A trigger
  group fires at most once per page load, so in this SPA the second
  `view_agent`, `view_credits` or `message_start` on the same page load is
  dropped. The tags already require `analytics_storage` via Consent Mode
  ("additional consent checks"), which is the correct gate — the trigger
  groups are redundant and lossy. GTM fix: fire each GA4 event tag on its plain
  `ce - <event>` trigger and drop the `tg - …` trigger groups. Until then,
  expect undercounts for repeated in-app events.
- **`onboarding_*`, `agent_hired`** no longer exist in the app (SOK-805 removed
  the marketplace Hire). GA4/Ads/LinkedIn/Meta tags keyed on them are dead.
- **Subscription `purchase`** is a known gap: Better Auth's Stripe plugin owns
  the subscription checkout and returns to `/billing?tab=subscription&status=success`
  with no session id, so there is nothing to build `transaction_id`/`value`
  from client-side. Closing it needs `{CHECKOUT_SESSION_ID}` on that
  `successUrl` (`lib/auth/subscription.server.ts`) plus a `PurchaseTracker`
  mount on the subscription tab. Only credits/coupons fire `purchase` today.

### Event parameters worth registering as GA4 custom dimensions

| Parameter | On event | Registered? |
|-----------|----------|-------------|
| `provider` | `sign_up`, `login` (`google`, `microsoft`, `credential`, `magic-link`, `passkey`) | yes |
| `agent_name`, `agent_price` | `view_agent` | yes |
| `plan`, `seats` | `begin_checkout` (subscriptions) | yes — but the GTM `GA4 - begin_checkout` tag must forward them |
| `room_id` | `message_start` | no — high cardinality; only register if you want per-coworker DM reports. GTM tag does not forward it today |
| `transaction_id`, `value`, `currency`, `items` | `purchase` | standard ecommerce — no dimension needed |
| `consent_analytics`, `consent_marketing` | `consent_status` | no GA4 tag; not needed |

## User-ID

After login we push an **opaque** Sokosumi user id (`session.user.id` — never
an email or a name) as `set_user_id`. The GA4 Configuration tag in GTM reads it
(`user_id` field = the `user_id` dataLayer variable), which stitches a visitor's
sessions and devices together. It is cleared on logout so a shared browser does
not misattribute the next person.

Caveat: the GA4 Configuration tag fires on Consent Initialization / History
Change, but `set_user_id` is pushed later (after the session resolves), so the
first page load's hits carry no `user_id` until the next route change re-fires
the config. GTM fix: add `ce - set_user_id` as a trigger on `GA4 - config`.

## UTMs & attribution

GA4 understands standard `utm_*` parameters with no extra work. Cross-domain
measurement (configured on the GA4 tag in GTM) carries the session — and thus
the original UTM source — from a `sokosumi.com` ad click through to a signup and
purchase on `app.sokosumi.com`. The app additionally persists first-touch UTMs
server-side (`POST /users/{id}/utm-attribution`).

## Adding an event

1. Add a method to `lib/gtm-events/index.ts` (`fireEvent({ event: "name", ... })`).
2. Call it from the client at the moment of success.
3. In GTM: a **Custom Event** trigger on the event name → a **GA4 Event** tag.
   No app deploy is needed for the GTM side.

## The GTM container

The container (GTM-N7GC8SFT) is configured in the GTM UI, not in this repo.
It contains, at minimum:

- **Consent Initialization** – so consent state is set first.
- **GA4 Configuration** (G-G4BW0XC76M) on All Pages, consent-gated
  (`analytics_storage`), with cross-domain (`sokosumi.com`, `app.sokosumi.com`)
  and `user_id` wired to the dataLayer variable.
- **GA4 Event** tags, one per event above, on Custom Event triggers.
- **Google Ads** conversion linker (AW-16455471438), consent-gated
  (`ad_storage`).

Test changes with **Tag Assistant** (Preview) before publishing, and confirm
storage-gated tags do not write analytics/ads cookies until consent is granted.
