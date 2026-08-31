# Ably Push Notifications research (SOK-699 closed-app delivery)

Researched 2026-08-26 against primary sources. Facts and citations only — no plan, no recommendations. Context: SOK-699 requires closed-app OS notifications via Ably Push (desktop Chrome, Android Home Screen PWA, iOS Home Screen PWA). The in-app Ably Pub/Sub path stays.

Provenance tags: VERIFIED = fetched/ran this session, output seen. REPORTED = second-hand (PR body, small-model summary). INFERRED = reasoned from verified facts. Ably doc pages carry no version/date stamps; all quotes are from the live `.md` renderings fetched 2026-08-26.

## Current Pub/Sub path (repo facts)

All VERIFIED (read this session in this worktree):

- `ably` pinned at **2.28.0** in both apps: `apps/web/package.json:60`, `apps/core/package.json:61`.
- Core publishes with `Ably.Rest` using `ABLY_PUBLISH_ONLY_KEY` (`apps/core/src/lib/ably/client.ts:10`). Env keys: `ABLY_PUBLISH_ONLY_KEY` at `apps/core/src/config/env.ts:201`, `ABLY_SUBSCRIBE_ONLY_KEY` at `apps/core/src/config/env.ts:203`.
- Notification fan-out: `createNotification` calls `publishNotificationCreated` at `apps/core/src/helpers/notifications.ts:104`, which calls `publishNotificationEvent` (`apps/core/src/lib/ably/publish.ts:94-101`) — event name `notification_created` on channel `notifications:all:user_{userId}` (`packages/utils/src/ably-channel.ts:18-19`).
- Client token mint: `apps/core/src/lib/ably/create-token-request.ts:48-73` mints an Ably `TokenRequest` from a `Rest` client keyed with `ABLY_SUBSCRIBE_ONLY_KEY`; `clientId` is `{userId}:{clientInstanceId}` (`buildAblyPresenceClientId`, comment at `create-token-request.ts:30-33`). Exposed via Core `POST /v1/realtime/ably-token` (`apps/core/src/routes/v1/realtime/ably-token/post.ts`).
- Capability map (`apps/core/src/lib/ably/subscribe-capability.ts:47-66`): only `subscribe` (jobs, tasks, notifications, chat control, chat rooms) and `presence`+`subscribe` (org presence). No push ops of any kind.
- Web singleton: `apps/web/src/lib/ably/realtime-singleton.client.ts:26-32` — `new Ably.Realtime({ authUrl: "/api/ably/auth", authMethod: "POST", authParams: { clientInstanceId } })`. Route at `apps/web/src/app/api/ably/auth/route.ts`. No `plugins` and no `pushServiceWorkerUrl` are passed today.

## Ably Push architecture

Source: https://ably.com/docs/push (`.md` fetched, VERIFIED).

- "Push notifications notify user devices or browsers regardless of whether an application is open and running." (push overview)
- "Ably sends push notifications to devices using Firebase Cloud Messaging or Apple Push Notification Service, and to browsers using Web Push." (push overview)
- "Push notifications don't require a device or browser to stay connected to Ably." (push overview)
- Two publish modes: "directly" (by `deviceId`, `clientId`, or raw `recipient`) or "via channels" (Pub/Sub fan-out to push-subscribed devices). VERIFIED, same page.
- Delivery chain: app/server → Ably → "the appropriate push notification service *FCM*, *APNs*, or Web Push" → device. Ably does not deliver the final hop itself. VERIFIED, "Push notification lifecycle" section.
- Connection accounting: "Push subscriptions do not count toward your connection limit" but "publishing push notifications via channels does activate those channels". VERIFIED, note on the same page.
- Error visibility: "Metachannels, such as `[meta]log:push`, publish events and errors that aren't otherwise available to clients." Client-returned errors are excluded. VERIFIED, push overview §Error handling. Metachannel table confirms: "`[meta]log:push` … only for errors that occur during delivery of Push Notifications" (https://ably.com/docs/metadata-stats/metadata/subscribe, VERIFIED).

## Web Push specifics (Ably)

Source: https://ably.com/docs/push/configure/web and https://ably.com/docs/push/getting-started/web (`.md` fetched, VERIFIED).

- VAPID is Ably-managed: "Ably automatically creates a VAPID key pair for your application" on first activation, and "Ably will then use the same VAPID key pair for all subsequent activations in the same application." No developer-held VAPID keys.
- A developer-authored service worker is required: "You must host a service worker to use to push messages." Ably's SDK does not display notifications; the doc's example SW is the whole contract:
  ```js
  self.addEventListener("push", (event) => {
    const { notification } = event.data.json();
    self.registration.showNotification(notification.title, notification);
  });
  ```
- Client setup: `import Push from "ably/push"` and `new Ably.Realtime({ pushServiceWorkerUrl: '/service_worker.js', plugins: { Push } })`. VERIFIED (configure/web).
- `await client.push.activate()` performs, per the getting-started guide (VERIFIED): 1. register the SW at `pushServiceWorkerUrl`; 2. "Request notification permission from the user"; 3. "Obtain a push subscription from the browser's Push API"; 4. "Register the device with Ably's push notification service." After activation `realtimeClient.device().id` is the Ably-assigned `deviceId`.
- Persistence: "once activated, the browser remains registered even after the application is closed until the `push.deactivate()` method is called. Calling activate again has no effect if the browser is already activated." VERIFIED (configure/web).
- Ably-js Web Push activation shipped in ably-js **2.3.0**: "Version 2.3.0 of the JS Client Library has been released" with web-push activation (https://changelog.ably.com/support-for-web-push-activation-added-to-ably-js-296671, REPORTED via WebFetch summary; repo pins 2.28.0 ≥ 2.3.0, VERIFIED).
- Browser matrix (getting-started §Browser compatibility, VERIFIED): Push API — Chrome/Edge "Full support", Firefox "Full support", Safari "Partial (macOS 13+)". Notification action buttons — "Not supported" in Safari, "Limited" in Firefox. Silent push — "Not supported" in Safari. Note: "Safari on macOS 13+ supports Web Push, but with some limitations."
- GA/beta status: no beta or GA label appears anywhere on the push doc pages fetched. The feature is documented as a plain product feature. Not determined beyond that (no explicit "GA" statement exists to quote).
- **Blind spot**: Ably's browser matrix does not mention iOS, iPadOS, or Home Screen PWAs at all. Whether Ably-brokered Web Push delivers to iOS Home Screen PWAs is *not stated in Ably docs*. INFERRED: it should, because Apple implements standard W3C Web Push (next section) and Ably speaks standard Web Push with its own VAPID keys — but no primary source asserts the combination.

## iOS Home Screen PWA specifics (Apple)

Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (published 2023-02-16, by Brady Eidson and Jen Simmons). Page HTML fetched raw this session; quotes below grepped from it — VERIFIED.

- Version floor: **iOS/iPadOS 16.4**. Verbatim: "iOS and iPadOS 16.4 beta 1 … comes support for Web Push" "for Home Screen web apps."
- Home Screen requirement: "A web app that has been added to the Home Screen can request permission" — Safari tabs on iOS cannot (for classic Web Push).
- User gesture: only "in response to direct user interaction — such as tapping on a 'subscribe' button".
- Standard, not APNs-credentialed: "the same W3C standards-based Web Push" as "Safari 16.1 for macOS Ventura" (Push API + Notifications API + Service Workers). Load-bearing pair, verbatim: delivery rides "the same Apple Push Notification service that powers native push", yet "You do not need to be a member of the Apple Developer Program". The sender speaks standard Web Push protocol; **no APNs certificates or keys are needed by the publisher** (Ably, in this case).
- Transport detail: "allow URLs from *.push.apple.com" when allowlisting push endpoints (same post). The earlier macOS post (https://webkit.org/blog/12945/meet-web-push/, REPORTED via WebFetch) matches: Safari registrations become "push subscriptions with the Apple Push Notification service".
- Declarative Web Push (newer, optional): "allows web developers to request a Web Push subscription and display user visible notifications without requiring an installed service worker"; testable "on iOS 18.4, iPadOS 18.4, and on the macOS 15.5 beta"; backward compatible ("if it arrives to an older browser, it's handled imperatively by JavaScript as it always had been") (https://webkit.org/blog/16535/meet-declarative-web-push/, REPORTED). Whether iOS Safari tabs (not Home Screen) get declarative push was not determinable from the fetched extract. Ably docs do not mention declarative web push at all (VERIFIED absence in fetched pages).

## Registration & device registry

Sources: push overview + configure/web (VERIFIED).

- Direct activation steps (configure/web, VERIFIED): authenticate the client → generate and locally save a unique browser identifier → register with the SW's push manager → "Register the browser with Ably, providing its unique identifier (`deviceId`), browser details, and push recipient information" → "Store the browser's identity token from Ably's response locally".
- So Ably brokers registration end-to-end: the Web Push endpoint + keys (the "push recipient") live in **Ably's device registry**, not in a Core table. Core does not need its own subscription table for delivery. VERIFIED (steps above) + INFERRED (the "does not need" consequence).
- What Core still owns: nothing stores the userId→device mapping for Core *unless* `clientId` carries it. Registry entries record the `clientId` the client was authenticated with at activation; publishing/subscribing by `clientId` then targets "all devices or browsers tied to a particular `clientId` … for example the same user's laptop and mobile phone" (push overview, VERIFIED). Mismatched registration attempts fail with error 61002 `device-registration-client-id-mismatch` (listed in llms.txt error index, VERIFIED title only).
- Repo collision: Sokosumi's minted `clientId` is `{userId}:{clientInstanceId}` (VERIFIED, `create-token-request.ts:68`), i.e. per-tab/device, not per-user. Publishing push "to the user" via `clientId` would hit exactly one instance id per publish under the current scheme. INFERRED from the two verified facts above.
- Server-assisted activation exists as an alternative: the browser still registers with Web Push, but "your server manages the browsers registration with Ably" via the Push Admin API, using `push.activate(registerCallback)` / `push.deactivate(deregisterCallback)` on the client (configure/web, VERIFIED).
- Auth of registry operations: each device holds a `deviceIdentityToken`, "a credential generated during registration to assert the device's or browser's identity" (push overview, VERIFIED). "The service credential management is handled by the Ably SDK" (same page).
- Lifecycle: registrations can lapse — error 41001: "Registrations expire over time, and the device must register again before it can receive notifications." (https://ably.com/docs/platform/errors/codes/41001-push-device-registration-expired, VERIFIED). Rejected tokens surface as error 103005 "the provider (APNs, FCM, or WebPush) rejected the device's push token as invalid" (VERIFIED). Whether Ably auto-deletes registrations after repeated delivery failures is **not determined** — no fetched page states an automatic cleanup policy; failures are observable on `[meta]log:push`.
- Token rotation: documented for native platforms via `push.updateToken()` (device page shows a React Native FCM example, VERIFIED). No equivalent Web Push subscription-rotation doc was found; configure/web's server-assisted section says the server updates identifiers "following the Web Push service's renewal" (VERIFIED) — for direct activation, rotation handling is not documented. Not determined.

## Targeting & publishing

Source: https://ably.com/docs/push/publish (`.md` fetched, VERIFIED).

- **Via channels** requires three things (verbatim list, VERIFIED): "1. Enable the push setting on the channel or channel namespace via rules. 2. Ensure clients have the `push-subscribe` capability. 3. Include a valid push notification payload in the message `extras` field."
- Channel push subscription is separate from realtime subscription: "subscribing to push notifications differs from subscribing to ordinary messages". Clients call `channel.push.subscribeDevice()` (this device) or `channel.push.subscribeClient()` (all devices with this `clientId`). Both need `push-subscribe`. VERIFIED.
- Publish payload shape on a channel message (VERIFIED example):
  ```js
  extras: { push: {
    notification: { title, body },   // OS-displayed part
    data: { foo: "bar" }             // app data; Web Push maps to notification.data
  } }
  ```
  Field mapping table (VERIFIED): `notification.title/body/icon` map to Web Push `notification.*`; `data` maps to Web Push `notification.data`; `notification.sound`/`collapseKey` are "Discarded" for Web Push. Per-transport overrides via `apns` / `fcm` / `web` objects.
- **Direct publishing** uses `push.admin.publish(recipient, payload)` with `recipient` = `{ deviceId }`, `{ clientId }`, or raw transport recipient attributes. `clientId` targeting "deliver[s] push notifications to a specific user rather than a single device" — the multi-device fan-out story. VERIFIED.
- Batch: `POST /push/batch/publish` accepts `PushPublishSpec[]`; "the batch push endpoint allows a maximum of 10,000 notifications per request (each recipient for a given payload counts as a separate notification)." VERIFIED.
- TTL: examples repeatedly annotate `ttl: 3600` as "Required for Web Push on some platforms and browsers like Microsoft Edge (WNS)". VERIFIED. Beyond that TTL comment, offline-device queueing/retention semantics are delegated to the downstream push service and are **not specified** in Ably docs (absence VERIFIED across push.md and push/publish.md; retention behavior itself not determined).
- Failure telemetry: `[meta]log:push` (see architecture section). Error codes 103000–103008 cover publish/delivery failures (llms.txt index, VERIFIED titles).

## Capabilities, keys, auth

Source: https://ably.com/docs/auth/capabilities (`.md` fetched, VERIFIED).

- Capability table (VERIFIED, verbatim): "**push-subscribe** | Can subscribe devices for push notifications" and "**push-admin** | Can manage device registrations and push subscriptions for all devices in an app".
- Push overview adds (VERIFIED): `push-admin` "grants full API access", while `push-subscribe` "designates a client as a push target device or browser. It can only manage its own registration and subscriptions, not those of other devices or browsers."
- Token intersection rule (VERIFIED): "The capabilities of the resulting token are the intersection of the requested capabilities and those of the issuing API key." Consequence for this repo: browser tokens minted from `ABLY_SUBSCRIBE_ONLY_KEY` can only carry `push-subscribe` if that **key itself** has `push-subscribe`; likewise Core can only call push-admin publish if `ABLY_PUBLISH_ONLY_KEY` (or a new key) has `push-admin`. INFERRED from the intersection rule + repo key usage.
- Key capabilities are edited outside the repo: "API key capabilities are configured using the dashboard, or using the Control API." Also: "When you change a key's capabilities in the dashboard, existing connections using that key do **not** receive the updated capabilities immediately." Both VERIFIED.
- Channel-based push additionally needs the **push channel rule** enabled on the target channel/namespace in the dashboard (getting-started prerequisite 3 + publish §via-channels, VERIFIED). The current `notifications:*` namespace has no such requirement today; whether a push rule exists on the Sokosumi Ably app is dashboard state and **not determined** from the repo.

## Limits, plans, gating

- No plan gating for push was found: the pricing overview and limits docs (https://ably.com/docs/platform/pricing, https://ably.com/docs/platform/pricing/limits, both `.md` fetched) contain **zero** occurrences of "push" (grep VERIFIED). Push availability per package: not determined; no doc asserts a restriction.
- An account-wide push rate limit exists: error 42926 — "A push notification was dropped because the publish rate of push notifications across the account exceeded the configured account-wide limit." and "Message publishing is unaffected." Metric name `pushRequests.maxRate`. Numeric per-plan values are not published. (https://ably.com/docs/platform/errors/codes/42926-rate-limit-exceeded-account-push-notifications, VERIFIED.)
- Push subscriptions don't consume connection quota; channel-based push publishes count the channel as active (push overview note, VERIFIED — quoted in architecture section).

## Canceled PR #3587 (reference only)

All REPORTED from `gh pr view 3587 --repo masumi-network/sokosumi` (state CLOSED, closed 2026-08-05, branch `cursor/sok-699-web-push-notifications-43b2`, author mrosberghaus) plus `gh pr diff --name-only` (both run this session; the diff itself was not read).

- Title: `feat(core): add web push subscriptions and send on notification create`. Body: "Delivery uses a service worker + Core-stored VAPID subscriptions, not an open Ably tab."
- What it built (PR body + file list): a `PushSubscription` Prisma model + migration (`packages/database/prisma/migrations/20260803204817_add_push_subscription/migration.sql`); Core routes `push-subscriptions` POST/DELETE and `push-vapid-public-key` GET; `sendPushForNotification` void-fired from `createNotification`; `apps/web/public/sw.js`; a `PushSubscriptionRegistrar` component and an Account push toggle; shared `getNotificationHref` in `@sokosumi/utils`; VAPID env keys in `apps/core/.env.example`.
- Why it exists in this doc: it is the self-managed `web-push`/VAPID design — Core owns the subscription table, the VAPID keys, and the send loop. SOK-699 forbids reviving that design; delivery must go through Ably Push, where Ably owns VAPID keys and the device registry (contrast: configure/web quotes above). The in-app dedupe idea in its SW ("skips OS banner when a focused client exists") is a design concern that will recur regardless of transport. REPORTED (PR body) + task framing.

## Discrepancies & open facts

Discrepancies with `.agents/skills/using-ably/SKILL.md` (read this session, VERIFIED):

1. The skill never mentions push notifications, `push.activate()`, `push-subscribe`/`push-admin`, service workers, or `extras.push` — its product table covers Pub/Sub, Chat, Spaces, LiveObjects, LiveSync, AI Transport only. It is silent, not wrong.
2. The skill's channel-rules line (§4) mentions "push notifications" as a rule type in passing — consistent with the docs' push channel rule requirement.
3. The skill's JWT example grants only `subscribe`/`publish`/`presence` ops; carrying push ops in `x-ably-capability` is undocumented there. The live capabilities page confirms push ops are ordinary capability operations, so the token path extends to them (intersection rule applies).

Open facts (feed for the grill):

- **iOS support of Ably Web Push is asserted nowhere.** Ably's matrix stops at "Safari — Partial (macOS 13+)"; Apple says iOS 16.4+ Home Screen PWAs speak standard Web Push. The combination is INFERRED, unverified by any doc or test.
- **clientId shape.** Registry targeting by `clientId` fans out per exact `clientId`; Sokosumi's `{userId}:{clientInstanceId}` defeats per-user fan-out. Options (wildcard targeting by clientId prefix? separate push clientId?) are not addressed in Ably docs; wildcard `clientId` targeting is not documented to exist.
- **Registry hygiene.** No documented automatic cleanup of dead Web Push registrations; expiry exists (41001) with unspecified timing; Web Push subscription rotation under direct activation is undocumented.
- **Ably-side queued-push retention for offline devices: not determined** (only the `ttl` field comment exists; retention is the downstream push service's behavior).
- **Numeric push rate limits per plan: not published.**
- **Plan gating: not determined** (absence of "push" in pricing docs is not proof all packages include it).
- **Channel-rule state of the Sokosumi Ably app** (push rule on any namespace, key capabilities of the two existing keys): dashboard state, not inspectable from the repo.
- Payload display: with Ably the page-owned SW must call `showNotification` itself; PR #3587's SW dedupe/click-focus logic would need re-implementing in the Ably-shaped SW. (SW content requirements VERIFIED; the carry-over is INFERRED.)

## Sources

| Source | URL |
| --- | --- |
| Ably push overview | https://ably.com/docs/push |
| Ably configure/activate web browsers | https://ably.com/docs/push/configure/web |
| Ably configure/activate devices (FCM/APNs) | https://ably.com/docs/push/configure/device |
| Ably publish & receive push | https://ably.com/docs/push/publish |
| Ably getting started: Web Push | https://ably.com/docs/push/getting-started/web |
| Ably capabilities | https://ably.com/docs/auth/capabilities |
| Ably metachannels | https://ably.com/docs/metadata-stats/metadata/subscribe |
| Ably pricing overview / limits | https://ably.com/docs/platform/pricing , https://ably.com/docs/platform/pricing/limits |
| Ably error 41001 / 103005 / 42926 | https://ably.com/docs/platform/errors/codes/41001-push-device-registration-expired , …/103005-push-device-token-invalid , …/42926-rate-limit-exceeded-account-push-notifications |
| ably-js 2.3.0 web push changelog | https://changelog.ably.com/support-for-web-push-activation-added-to-ably-js-296671 |
| WebKit: Web Push for Web Apps on iOS/iPadOS | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| WebKit: Meet Web Push (macOS) | https://webkit.org/blog/12945/meet-web-push/ |
| WebKit: Meet Declarative Web Push | https://webkit.org/blog/16535/meet-declarative-web-push/ |
| PR #3587 (closed) | `gh pr view 3587 --repo masumi-network/sokosumi` |
| Repo skill (stale-checked) | `.agents/skills/using-ably/SKILL.md` |

Method blind spots: Ably `.md` pages and the WebKit iOS post were fetched raw and quoted directly (VERIFIED). The macOS meet-web-push post, the Declarative Web Push post, and the ably-js changelog entry came through a WebFetch extraction model (REPORTED — extractor can misquote). `gh pr diff 3587` content was not read (only file names). No live Ably app/dashboard state was inspected, and no push delivery was tested against a real iOS device.
