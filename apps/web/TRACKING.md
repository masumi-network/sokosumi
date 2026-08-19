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
| `sign_up` `{provider}`| account created                                | auth |
| `login` `{provider}`  | signed in                                      | auth |
| `message_start` `{room_id}` | **a coworker DM is started** (first send per room) | `app/(app)/chat/hooks/use-coworker-direct-room-stream.ts` |
| `begin_checkout`      | checkout opened                                | billing |
| `purchase` `{transaction_id, value, currency, items}` | **a subscription / credit purchase succeeds** | `components/billing/purchase-tracker.tsx` |
| `view_agent`, `view_credits`, `view_register_area`, `view_login_area`, `register_form_start`, `login_area_form_start`, `doi_confirmed` (defined, not yet fired — no call site) | funnel context | various |
| `consent_status` `{consent_analytics, consent_marketing}` | cookie choice made | banner |
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

## User-ID

After login we push an **opaque** Sokosumi user id (`session.user.id` — never
an email or a name) as `set_user_id`. The GA4 Configuration tag in GTM reads it
(`user_id` field = the `user_id` dataLayer variable), which stitches a visitor's
sessions and devices together. It is cleared on logout so a shared browser does
not misattribute the next person.

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
