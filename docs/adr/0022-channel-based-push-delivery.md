# ADR 0022: Closed-app push rides the per-user notifications channel

- Status: Accepted
- Date: 2026-08-26
- Amended: 2026-09-07

Closed-app OS notifications (SOK-699) use Ably **channel-based push** on the per-user notifications channel. Production, development, and pre-production keep the existing `notifications:all:user_{userId}` channel. A Vercel preview uses `notifications:preview:{network}:branch_{encodedGitRef}:user_{userId}`. Core and Web derive the name from the same shared helper. One publish still serves the realtime feed and push. We do not use direct Push Admin publishing (`push.admin.publish` per device or clientId), and Core keeps no push-subscription table. Ably's device registry owns registrations and VAPID keys.

**Why:** Our Ably `clientId` is `{userId}:{clientInstanceId}` (one per tab/device), so per-user fan-out by `clientId` — the direct-publish multi-device story — does not work without changing an identity scheme that org presence depends on. The channel route reuses the channel, the token mint, and the single publish chokepoint that already exist. The canceled `web-push`/VAPID attempt (PR #3587) is explicitly not the design (SOK-699).

**The web must subscribe by device, not by client.** `subscribeDevice()` posts `{ deviceId, channel }`, and `deviceId` lives in `localStorage` (`ably@2.28.0` `webstorage.ts` uses `localStorage` unless a session flag is passed, and push config passes none), so one subscription survives new tabs and browser restarts. `subscribeClient()` posts `{ clientId, channel }`, and our `clientId` is `{userId}:{clientInstanceId}` with the instance id in `sessionStorage` (`ably-client-instance-id.ts`), so every tab would create its own subscription and dead ones would accumulate. Use `subscribeDevice()`.

For the record, an earlier draft of this ADR feared that the per-tab `clientId` would break re-activation with error 61002 (`clientId not compatible with local device clientId`). It does not. `ably@2.28.0` never persists a clientId: `persistKeys` (`pushactivation.ts:17-23`) covers only `deviceId`, `deviceSecret`, `deviceIdentityToken`, `pushRecipient`, and `activationState`, and `persist()` writes only those. `LocalDevice.clientId` is re-read from `rest.auth.clientId` on every hydration, then compared against `machine.client.auth.clientId` on the same client, so the two sides cannot differ. That guard is for platforms that persist a supplied clientId, not for us. The real per-tab exposure is the subscription API above.

**Consequences:**

- Push filtering (opt-out, per-kind muting) happens at publish time in Core: skip or shape `extras.push` per user preference. It is user-level, not per-delivery.
- Preview realtime events and new preview device subscriptions stay on their network and Git branch. A preview without `VERCEL_GIT_COMMIT_REF` fails instead of joining the production channel.
- Preview isolation assumes the preview Web app reaches the same-branch preview Core, which mints the token. Both sides then feed the shared helper the same network, `VERCEL_ENV`, and `VERCEL_GIT_COMMIT_REF`, so the granted capability and the subscribed channel match. When a preview Web instead reaches a non-preview Core, the token grants only `notifications:all:user_{userId}`, the preview channel subscription fails, and no production events leak.
- Preview device activation requires a fresh browser confirmation. The app stores no confirmation choice.
- Notification clicks use the stable Vercel branch URL on previews and the project production URL on production. Local development keeps the current origin.
- Existing preview devices can remain subscribed to the production channel. They keep receiving production pushes until the user disables push or clears the site's data. This compatibility limit was accepted for the migration. New preview activations use only the preview channel.
- The browser token capability set and the `ABLY_SUBSCRIBE_ONLY_KEY` dashboard key must gain `push-subscribe`; the `notifications` namespace needs a push channel rule (dashboard state).
- Future device-level or per-kind granularity stays inside this architecture: devices self-manage their own registrations/subscriptions (`push-subscribe` scope), and Core can manage any device's channel subscriptions server-side via `push-admin` ("can manage device registrations and push subscriptions for all devices in an app"). Splitting channels per kind remains open as a later evolution.

**Rejected:** direct Push Admin publishing per notification (requires identity change or Core-side device bookkeeping); reviving PR #3587's Core-owned `PushSubscription` table and self-managed VAPID keys.
