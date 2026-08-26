# ADR 0017: Closed-app push rides the per-user notifications channel

- Status: Accepted
- Date: 2026-08-26

Closed-app OS notifications (SOK-699) use Ably **channel-based push** on the existing `notifications:all:user_{userId}` channel. Devices call `push.activate()` and push-subscribe to that channel; Core adds an `extras.push` payload to the `notification_created` publish it already makes in `createNotification`. One publish serves the realtime feed and push. We do not use direct Push Admin publishing (`push.admin.publish` per device or clientId), and Core keeps no push-subscription table — Ably's device registry owns registrations and VAPID keys.

**Why:** Our Ably `clientId` is `{userId}:{clientInstanceId}` (one per tab/device), so per-user fan-out by `clientId` — the direct-publish multi-device story — does not work without changing an identity scheme that org presence depends on. The channel route reuses the channel, the token mint, and the single publish chokepoint that already exist. The canceled `web-push`/VAPID attempt (PR #3587) is explicitly not the design (SOK-699).

**The web must subscribe by device, not by client.** `subscribeDevice()` posts `{ deviceId, channel }`, and `deviceId` lives in `localStorage` (`ably@2.28.0` `webstorage.ts` uses `localStorage` unless a session flag is passed, and push config passes none), so one subscription survives new tabs and browser restarts. `subscribeClient()` posts `{ clientId, channel }`, and our `clientId` is `{userId}:{clientInstanceId}` with the instance id in `sessionStorage` (`ably-client-instance-id.ts`), so every tab would create its own subscription and dead ones would accumulate. Use `subscribeDevice()`.

For the record, an earlier draft of this ADR feared that the per-tab `clientId` would break re-activation with error 61002 (`clientId not compatible with local device clientId`). It does not. `ably@2.28.0` never persists a clientId: `persistKeys` (`pushactivation.ts:17-23`) covers only `deviceId`, `deviceSecret`, `deviceIdentityToken`, `pushRecipient`, and `activationState`, and `persist()` writes only those. `LocalDevice.clientId` is re-read from `rest.auth.clientId` on every hydration, then compared against `machine.client.auth.clientId` on the same client, so the two sides cannot differ. That guard is for platforms that persist a supplied clientId, not for us. The real per-tab exposure is the subscription API above.

**Consequences:**

- Push filtering (opt-out, per-kind muting) happens at publish time in Core: skip or shape `extras.push` per user preference. It is user-level, not per-delivery.
- The browser token capability set and the `ABLY_SUBSCRIBE_ONLY_KEY` dashboard key must gain `push-subscribe`; the `notifications` namespace needs a push channel rule (dashboard state).
- Future device-level or per-kind granularity stays inside this architecture: devices self-manage their own registrations/subscriptions (`push-subscribe` scope), and Core can manage any device's channel subscriptions server-side via `push-admin` ("can manage device registrations and push subscriptions for all devices in an app"). Splitting channels per kind remains open as a later evolution.

**Rejected:** direct Push Admin publishing per notification (requires identity change or Core-side device bookkeeping); reviving PR #3587's Core-owned `PushSubscription` table and self-managed VAPID keys.
