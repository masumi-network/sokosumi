"use client";

import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";

/**
 * The credential `ably@2.28.0` stores for a registered push device
 * (`build/push.js:265`).
 *
 * This is the key that tracks a live registration, and the only one of the
 * five that does. Deregistering removes it and `ably.push.pushRecipient`
 * (`build/push.js:913-916`), then calls `resetId()`, which mints a new id and
 * writes `ably.push.deviceId` and `ably.push.deviceSecret` straight back
 * (`build/push.js:419-423`, persisting at `:405-410`). Reading the id instead
 * would say "registered" forever, and every later sign-out would build a
 * client and mint a token only to fail without this token
 * (`build/push.js:155-159`).
 */
const ABLY_DEVICE_IDENTITY_TOKEN_KEY = "ably.push.deviceIdentityToken";

/**
 * Whether Ably still holds a registration for this browser.
 *
 * Read separately from the browser subscription, because the two come apart.
 * `activatePush` already heals the case: a subscription can die on its own
 * (permission revoked, storage cleared, a half-failed disable) while Ably's
 * registration stays. That device is still subscribed to the previous reader's
 * notifications channel, and the next reader's activation reuses the same id
 * and adds their channel beside it, so one browser ends up delivering both.
 * Releasing on the registration too is what stops that.
 */
function hasAblyPushRegistration(): boolean {
  try {
    return localStorage.getItem(ABLY_DEVICE_IDENTITY_TOKEN_KEY) !== null;
  } catch {
    // Reading storage throws outright where the browser blocks site data.
    return false;
  }
}

/**
 * How long the sign-out waits for the release before it goes anyway.
 *
 * The browser unsubscribe leads and is local, so this only ever sheds the
 * Ably half. That half is two REST calls, and `ably@2.28.0` allows each of
 * them a 10s request timeout on top of 15s of fallback-host retries
 * (`build/ably.js:790-791`). An Ably incident or a captive portal would
 * otherwise hold the reader on a disabled Log out button for about half a
 * minute. Signing out is the more urgent of the two.
 */
const RELEASE_TIMEOUT_MS = 5_000;

/**
 * Drop this browser's push registration before an explicit sign-out.
 *
 * Web Push needs no session. The push service keeps delivering to the
 * endpoint it holds and the service worker keeps rendering banners, so a
 * browser left signed out would go on showing the previous reader's chat
 * mentions to whoever uses it next. Ably's device identity token goes with the
 * deactivation, so the browser stops counting as a registered device.
 *
 * Only an explicit sign-out calls this. A session that expires on its own
 * does not, so a reader who comes back finds push still on and never has to
 * turn it on again.
 *
 * Must run before `signOut()`: deactivation mints an Ably token, which needs
 * the session that is about to end. It is capped, so a slow Ably cannot hold
 * the reader on the button; what the cap sheds is a device record Ably prunes
 * once its endpoint stops answering.
 */
export async function releasePushDeviceOnSignOut(
  userId: string | undefined,
): Promise<void> {
  try {
    // The support check and both registration reads are local, so a reader who
    // never enabled push pays nothing and never loads the Ably SDK. Inside the
    // `try` with the rest: a throw from any of them would otherwise reject,
    // and the reader could then not sign out at all.
    if (!userId || !isPushSupported()) {
      return;
    }

    if (!(await hasWebPushSubscription()) && !hasAblyPushRegistration()) {
      return;
    }

    const { deactivatePush } = await import("./push-activation.client");

    // Caught here rather than by the `catch` below, because the cap can let
    // the sign-out go before this settles. The alternative for a late
    // rejection is no handler at all.
    const release = deactivatePush(userId).catch((error) => {
      console.error("Failed to release the push device on sign out", error);
    });

    let capTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      release,
      new Promise<void>((resolve) => {
        capTimer = setTimeout(resolve, RELEASE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(capTimer);
  } catch (error) {
    // Signing out must not fail because Ably did. The registration is then
    // still live, and the reader can clear it from the settings switch or
    // from the browser's own site data.
    console.error("Failed to release the push device on sign out", error);
  }
}
