# ADR 0018: Web owns push rendering — data-only payloads, one OS-banner renderer

- Status: Accepted
- Date: 2026-08-26

Push payloads (SOK-699) carry **data only**: the same fields as the realtime `notification_created` event (notification id, kind, `messageKey`, `messageParams`, `referenceId`, metadata). Core sets no `notification` title/body part. The web-owned service worker builds title, body, and destination href from that data, and its registration (`registration.showNotification`) is the **single OS-banner renderer**: pages trigger it for realtime events on unfocused tabs; the push event triggers it when the app is closed. The `new Notification()` constructor path from SOK-698 is deleted, not kept alongside.

**Why:** Notification text and hrefs are localized and routed web-side (next-intl, web routing helpers); Core has no web message catalog. Rendering server-side would either duplicate a string catalog into Core or move href routing into `@sokosumi/utils` — the restructuring that sank the canceled PR #3587. Two display paths (page `Notification()` + SW push) double-banner an open-but-unfocused tab; a single renderer removes the dedupe problem instead of managing it, and is iOS-correct by construction (`Notification()` never worked there; SW display is what installed PWAs support).

**Consequences:**

- The SW bundles the push-relevant message strings per locale (v1: the CHAT keys). Adding a pushed kind means adding its strings to the SW map.
- One `notificationclick` handler focuses-or-opens the destination; one tag scheme (notification id) dedupes replays.
- Shared show/skip rule: skip display when a visible focused Sokosumi client exists. Verify on iOS whether skipped displays count against Apple's silent-push tolerance; display-anyway on iOS if so.
- If the SW fails, nothing displays — there is no OS-rendered fallback title. Verify Ably delivers web pushes with an empty `notification` part.

**Rejected:** Core-rendered title/body (locale + catalog duplication in Core); keeping `new Notification()` beside the SW with tag/skip dedupe between two permanent paths; shared-package href routing (PR #3587's shape).
