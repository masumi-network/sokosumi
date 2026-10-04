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
Vercel custom events are listed under
[Vercel Analytics events](#vercel-analytics-events).

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
| `sign_up` `{provider}`| account created. Credential and email code fire in place, before the full-document leave in `lib/auth/finish-auth.client.ts`. A password sign-up is sent with the email code ([ADR 0050](../../docs/adr/0050-password-sign-up-proves-the-address.md)) and still counts once, as `credential`. Social fires once per new account, on whichever page claims it first: the callback page, or the OAuth hand-back during a Sign in with Sokosumi request — see [Social sign-ups](#social-sign-ups) | `components/use-email-code.ts` (from `signup/components/form.tsx`), `components/social-auth-callback.tsx`, `components/oauth-hand-back.tsx` |
| `login` `{provider}`  | signed in. Social fires on `/auth/callback/signin` after the full page load. Credential (`signin/components/form.tsx`), passkey (`social-buttons.tsx`) and email code (`use-email-code.ts`) fire in place, before the full-document leave in `lib/auth/finish-auth.client.ts` | `components/social-auth-callback.tsx`, `signin/components/form.tsx`, `components/social-buttons.tsx`, `components/use-email-code.ts` |
| `message_start` `{room_id}` | **a coworker DM is started** (first send per room) | `app/(app)/chat/hooks/use-coworker-direct-room-stream.ts` |
| `begin_checkout` `{plan?, seats?}` | Stripe checkout opened — credits/coupon (no params) and subscription upgrade (`plan`, org `seats`) | `components/credits/*-form.tsx`, `components/billing/*-subscription-section.tsx` |
| `purchase` `{transaction_id, value, currency, items}` | **a checkout succeeds**: credits/coupon (Stripe returns with `session_id`) or subscription (returns with `checkout_session_id`) — see [Purchase tracking](#purchase-tracking) | `components/billing/purchase-tracker.tsx`, mounted by `credits-checkout-return.tsx` and `subscription-checkout-return.tsx` |
| `view_agent`, `view_credits`, `view_register_area`, `view_login_area`, `register_form_start`, `login_area_form_start` | funnel context | various |
| `consent_status` `{consent_analytics, consent_marketing}` | cookie choice made (banner) **and** on every full page load when the cookie already exists (`consent-mode-init.tsx`). Not re-pushed on SPA route changes — see [Why events go missing](#why-events-go-missing) | banner, `consent-mode-init.tsx` |
| `set_user_id` `{user_id}` | login state resolves (and on logout, null) | `components/analytics/analytics-user-id.tsx` |

Marketplace app Hire (`agent_hired` / `use-job-submission`) was removed with
SOK-805. Job starts via Soko Bot/Coworker/Core API are not tracked as a web GTM
conversion event yet.

The two the business cares about most map cleanly:

- **Starting direct messages** → `message_start`
- **Subscribing** → `purchase` (with `begin_checkout` as the step before)

Mark `sign_up` and `purchase` as **key events** (conversions) in GA4; add
`message_start` if you want it as a conversion too.
Drop any GTM conversion that still keys on `agent_hired`.

### Why events go missing

Lessons from the Aug 2026 GA4 audit — keep these in mind when adding events.

- **Better Auth hard-redirects whenever `callbackURL` is set.** `signIn.email`
  and `signUp.email` with a `callbackURL` make the Better Auth client set
  `window.location.href` inside its fetch hook, *before* the caller's code
  after `await` runs. A `fireGTMEvent.*` placed after such a call is dead code
  (GA4 showed 0 credential logins against 145 `login_area_form_start`, and
  credential `sign_up` lost the same race until Sept 2026, along with the
  signup UTM conversion call). Credential sign-in, credential sign-up,
  passkey and email code therefore pass **no** `callbackURL`: they wait for the session, fire
  in place, then leave with `window.location.replace`
  (`lib/auth/finish-auth.client.ts`).
- **That leave must be a full document load.** `router.replace` is served the
  pre-login middleware result still sitting in the Next client router cache
  (anonymous `/` → `/signin`), so it bounces back to the form. Social sign-in
  has no choice about the hop (the provider's redirect must land
  somewhere), so it fires on the page that full-page load lands on:
  `/auth/callback/signin?provider=…`. That page lives outside the `(auth)`
  marketing layout so the hard nav does not re-render the hero, and its own
  `router.replace` is fine because it runs in a fresh document.
- **An OAuth request skips the social callback page.** When a product such as
  CMO sends someone through Sign in with Sokosumi, Core's OAuth provider
  answers the Google/Microsoft callback itself (its after hook on every
  response that sets the session cookie) and redirects to the product. Better
  Auth's `newUserCallbackURL` is never followed, so `/auth/callback/signup`
  never ran and those sign-ups fired no `sign_up` until Oct 2026. See
  [Social sign-ups](#social-sign-ups).
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

### Social sign-ups

A Google or Microsoft sign-up leaves through the provider, so no page that
started it can count it. Core is the one place that sees every new account:

1. `databaseHooks.user.create.after` records a pending sign-up conversion
   when the account comes from a provider callback (`/callback/:id` or the
   preview completion `/callback/:id/oauth-proxy`): two
   `verification` rows, `sign-up-conversion:<userId>` and
   `sign-up-conversion-redirect:<userId>`, valid one hour
   (`apps/core/src/lib/auth-sign-up-conversion.ts`).
2. Outside an OAuth request the browser lands on `/auth/callback/signup`.
   During one, a `prompt=create` request lands on `/signup` anyway; otherwise
   the OAuth provider's `signup.shouldRedirect` takes the redirect row and
   sends the authorization to `/signup`. There the hand-back counts the
   sign-up before `/oauth2/continue`. The redirect row is single-use, so a
   claim that keeps failing cannot loop the browser back to `/signup`.
3. Either page calls `claimSignUpConversion`, which asks Core
   (`POST /v1/users/me/sign-up-conversion`) with the existing UTM cookie data.
   Only an interactive session may claim its own conversion through `me`.
   Core deletes both rows and records UTM attribution in one transaction.
   A failed write rolls back the claim and keeps the cookie for a later retry.
   Core returns the provider to the first claim, so the second page, a reload,
   or a later hand-back gets `null` and fires nothing.

A sign-up no page claims within the hour is not counted, and neither is one
whose Core record failed (reported to Sentry, tag `sign_up_conversion`).
Claim errors are logged on the Web server and let sign-in continue; the Core
request times out after five seconds. The count is the claim, not `sign_up`'s delivery: a
refused consent or a blocked tag still claims it. The hand-back pushes
`sign_up` and then waits for `/oauth2/continue` before the page leaves.
This is at-most-once claiming, not exactly-once analytics delivery: a lost
claim response, a closed page, or a blocked tag can lose the browser event.

### Vercel Analytics events

Custom events sent with `track` from `@vercel/analytics`. They record intent
(the button or form used), not success, and are not consent-gated.

| Event | Properties | Fires when… | Where |
|-------|------------|-------------|-------|
| `Sign In` | `provider` (`google`, `microsoft`, `passkey`, `credential`, `email-otp`); `direct_signup_link: false` on provider buttons | a sign-in method is chosen on `/signin` | `signin/components/form.tsx`, `components/social-buttons.tsx` |
| `Sign Up` | `provider` (`google`, `microsoft`, `credential`, `email-otp`); `direct_signup_link` on provider sign-ups (`true` for `/auth/google` and `/auth/microsoft`) | a sign-up method is chosen on `/signup`, or a direct sign-up link starts | `signup/components/form.tsx`, `components/social-buttons.tsx`, `components/social-signup-auto-initiator.tsx` |
| `Project created` | `source`, `variant` | a project is created | `projects/components/create-project-wizard.tsx`, `projects/components/project-form.tsx` |

Before Oct 2026 the provider buttons on `/signup` and the direct sign-up links
sent `Sign In`, so earlier `Sign Up` counts lack social sign-ups.

### Purchase tracking

`purchase` fires for exactly two things, both on `/billing` after a Stripe
Checkout return:

1. a credit top-up or coupon checkout (return carries `session_id`), and
2. a self-serve subscription checkout started from the Subscription tab,
   personal or organization (return carries `checkout_session_id`).

Nothing else fires it: not plan changes that Better Auth applies without a
Checkout (upgrade returns no redirect URL), not seat changes, not renewals, not
enterprise contracts, and not a bare `status=success` in the URL.

The URL is never trusted. Both paths only mount `PurchaseTracker` after Core's
`GET /v1/checkout/sessions/{sessionId}` confirms the Stripe Checkout Session.
Core returns 404 unless the session is `complete`, its `payment_status` is not
`unpaid` (async payments that have not cleared, or a subscription that is not
active yet), and it belongs to the caller (`metadata.userId`, or a Stripe
customer of the user or one of their organizations). The event values come from
Stripe, not the URL: `transaction_id` = Checkout Session id, `currency`, and
`items` from the line items' products (the plan name for subscriptions; items
carry no price). `value` is **net revenue in major units**: `amount_total`
minus tax and tax-exclusive shipping (discounts are already applied), converted
with Stripe's minor-unit exponent
(EUR 4900 → 49, JPY 4900 → 4900, KWD 4900 → 4.9;
`stripeAmountToMajorUnits` in Core). Stripe's special cases are honoured: UGX
and ISK stay two-decimal in the API (UGX 4900 → 49) even though Stripe lists
UGX as zero-decimal, and HUF/TWD are two-decimal for charges. A trial or 100 % coupon completes with
`no_payment_required` and fires with `value` 0.

Before Sept 2026 `value` was Stripe's raw `amount_total` (minor units, tax
included), so historical GA4/Ads revenue for credit purchases is ~100× too high.
Compare periods across that change with care.

`PurchaseTracker` dispatches only while **analytics consent is granted**
(`sokosumi_consent`). With no decision yet it waits for the banner
(`CONSENT_CHANGE_EVENT`, dispatched by `applyConsentMode` after
`consent_status`) and dispatches then; a refusal never does. A session id is
marked as fired, in memory and in `sessionStorage`, only after the dataLayer
push returned without throwing. That proves local dispatch, not that GA4
received the hit (an ad blocker or network failure can still drop it). This
means a tab switch or a reload of the return URL does not fire it again, while a
purchase blocked by missing consent can still fire after a later grant on the
same page or a reload. Dismissing the subscription success modal removes only
`status`; it preserves `checkout_session_id` and the current billing tab so a
later consent decision can still dispatch the purchase. A different tab or
browser could fire it again; GA4
dedupes on `transaction_id`.

- **Credits / coupons**: Core creates the session with
  `success_url=…?session_id={CHECKOUT_SESSION_ID}`; `CreditsCheckoutReturn`
  reads `session_id`.
- **Subscriptions**: Better Auth's Stripe plugin owns the session. It never
  hands our `successUrl` to Stripe directly; it sets Stripe's `success_url` to
  its own `/subscription/success?callbackURL=<our URL, encoded>&checkoutSessionId={CHECKOUT_SESSION_ID}`,
  syncs the subscription there, then redirects to `callbackURL` after
  `replaceAll("{CHECKOUT_SESSION_ID}", checkoutSessionId)`.
  `lib/auth/subscription.server.ts` therefore appends a **literal**
  `checkout_session_id={CHECKOUT_SESSION_ID}` to the success URL
  (`withCheckoutSessionIdPlaceholder`; `URLSearchParams` would encode the
  braces and the plugin's replace would miss). The billing page passes
  `checkout_session_id` to `SubscriptionCheckoutReturn`, which ignores anything
  that is not a `cs_…` id (the plugin skips the replace on some early exits).
  The param is deliberately not `session_id`, so a subscription return never
  opens the credits success modal.

### Event parameters worth registering as GA4 custom dimensions

| Parameter | On event | Registered? |
|-----------|----------|-------------|
| `provider` | `sign_up`, `login` (`google`, `microsoft`, `credential`, `email-otp`, `passkey`) | yes |
| `agent_name`, `agent_price` | `view_agent` | yes |
| `plan`, `seats` | `begin_checkout` (subscriptions) | yes — but the GTM `GA4 - begin_checkout` tag must forward them |
| `room_id` | `message_start` | no — high cardinality; only register if you want per-coworker DM reports. GTM tag does not forward it today |
| `transaction_id`, `value`, `currency`, `items` | `purchase` | standard ecommerce — no dimension needed |
| `consent_analytics`, `consent_marketing` | `consent_status` | no GA4 tag; not needed |

## Internal traffic

Team members keep their own visits out of GA4/Ads by opening any
`sokosumi.com` or `app.sokosumi.com` URL with `?internal=1`. That sets
**`sokosumi_internal=1`** (domain `.sokosumi.com`, path `/`, one year);
`?internal=0` clears it. The marketing site and the app read and write the same
cookie, so setting it on either domain covers both.

While the cookie is set the app loads neither GTM nor the standalone GA4 tag
(`components/analytics/google-tags.tsx` wraps both mounts;
`lib/analytics/internal-traffic.ts`). After handling the param the app removes
`internal` from the visible URL with `history.replaceState`.
An explicit `internal=1` also suppresses tags for the current page when the
browser refuses cookie persistence. The cookie and URL cleanup run even on
deployments without Google IDs configured.

Consent Mode init and dataLayer pushes still run but go nowhere. Vercel
Analytics / Speed Insights are unaffected. The flag is per browser, so set it
once on each browser and device you use.

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
server-side (`POST /users/{id}/utm-attribution`): credential and email code
sign-ups before leaving the form, social sign-ups when their sign-up is
claimed (see [Social sign-ups](#social-sign-ups)).

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
