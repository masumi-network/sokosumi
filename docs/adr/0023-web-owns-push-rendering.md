# ADR 0023: Web owns push rendering — data-only payloads, one OS-banner renderer

- Status: Accepted
- Date: 2026-08-26
- Amended: 2026-09-08 (SOK-915 two tag schemes — now the live rule)

Push payloads (SOK-699) carry **data only**: the same fields as the realtime
`notification_created` event (notification id, kind, `messageKey`,
`messageParams`, `referenceId`, metadata). Core sets no `notification`
title/body part. The web-owned service worker builds title, body, and
destination from that data, and `registration.showNotification` is the
**single OS-banner renderer**: pages trigger it for realtime events on
unfocused tabs; the push event triggers it when the app is closed.

**Why:** Notification text and hrefs are localized and routed web-side
(next-intl, web routing helpers); Core has no web message catalog. Rendering
server-side would either duplicate a string catalog into Core or move href
routing into `@sokosumi/utils` — the restructuring that sank the canceled PR
#3587. Two display paths (page `Notification()` + SW push) double-banner an
open-but-unfocused tab; a single renderer removes the dedupe problem instead
of managing it, and is iOS-correct by construction (`Notification()` never
worked there; SW display is what installed PWAs support).

**Live rules:**

- The SW bundles the push-relevant message strings per locale (v1: the CHAT
  keys). Adding a pushed kind means adding its strings to the SW map. The two
  renderers each hold a copy of two rules (which banner a notification belongs
  to, and which line it reads under once several messages are waiting);
  `push-service-worker-display.test.ts` fails when either copy is edited
  alone.
- **Two tag schemes (SOK-915).** A chat notification is tagged
  `sokosumi-room:<referenceId>`, so a mention, a direct message, and a room's
  counted row share one banner per conversation. Everything else keeps its
  notification id. The prefix exists because room ids and notification ids
  come from one generator. A replayed push for a room still replaces rather
  than stacks. Past one message a chat banner says how many are waiting;
  Core sends that number as `groupCount` on the publish envelope
  (string-encoded like every other push value), summed from what each unread
  row for the room stands for, only on an unread chat row. It is not the
  row's stored `count`.
- **Click.** Focus a tab that can act and hand it the target. With no such
  tab, open the app with `?notification=` carrying the target so the page
  routes (workspace switch included). The worker does not build an href —
  that would duplicate the app's routing, which is the duplication this ADR
  exists to avoid.
- **Self-heal.** On app wake, `healPushSubscription` re-activates when
  remembered consent is missing a live subscription. The settings card still
  only reads the subscription on mount.
- **Show/skip** is platform-scoped. Chromium skip only when a focused,
  visible client answers that it renders the notification itself. A
  same-origin tab that renders nothing does not suppress the banner. WebKit
  always displays — idempotently: same `tag` replaces in place, `renotify`
  unset. Firefox does **not** suppress a banner for a focused origin; that
  surplus banner stands, because widening the skip trades it for a revoked
  subscription.
- Push data is a flat string-to-string map. Core JSON-encodes `messageParams`
  and omits `metadata` when it is null.
- If the SW fails, nothing displays — there is no OS-rendered fallback title.
  Core ships **no** `notification` part. Ably applies its own TTL; if an
  offline device needs an explicit one, `extras.push.web` is where to look,
  with evidence.
- Activation must stop `ably@2.28.0` asking for the OS notification
  permission a second time. `getW3CPushDeviceDetails` opens with
  `await Notification.requestPermission()`, so on WebKit that request lands
  outside the user gesture and resolves `denied` even while stored permission
  reads `granted`. The web client answers from the stored permission for the
  duration of activation (ably/ably-js#2071, unreleased as of `2.28.0`).

## Spent

- The `new Notification()` constructor path from SOK-698 is deleted.
- First-slice “settings card reads, nothing re-activates” and “closed-app
  click lands on the app root” are spent. SOK-876 shipped the wake heal and
  the `?notification=` handoff.
- 2026-08-27: Ably delivers a push carrying no `notification` part at all;
  the worker renders it on Firefox, Chromium, and an installed iOS web app.
  An earlier revision published `notification: { ttl }`; Ably does not read
  `ttl` there, it was dropped as undefined input. A commit that claimed that
  field blocked delivery was wrong — macOS Focus mode was filing banners into
  Notification Centre, and Ably's push log does not record web push.

**Rejected:** Core-rendered title/body (locale + catalog duplication in Core);
keeping `new Notification()` beside the SW with tag/skip dedupe between two
permanent paths; shared-package href routing (PR #3587's shape).
