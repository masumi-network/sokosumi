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
 * How long a release is waited on before the caller goes anyway.
 *
 * The browser unsubscribe leads and does not wait on the network, so this
 * only ever sheds the Ably half. `PushSubscription.unsubscribe()` deactivates
 * the subscription and resolves; its request to the push service runs "in
 * parallel" and the browser retries that on its own. The browser "MUST NOT
 * deliver any further push messages" from the moment it deactivates, whether
 * that request lands or not (W3C Push API, `unsubscribe()` steps 4-5). So the
 * step that stops delivery is never the one this cap cuts.
 *
 * Chromium matches: `PushMessagingServiceImpl::DidClearPushSubscriptionId`
 * runs the unsubscribe callback "*before* asking the InstanceIDDriver/
 * GCMDriver to unsubscribe, since that's a slow process involving network
 * retries, and by this point enough local state has been deleted that the
 * subscription is inactive".
 *
 * The Ably half is two REST calls, and `ably@2.28.0` allows each of them a 10s
 * request timeout on top of 15s of fallback-host retries
 * (`build/ably.js:790-791`). An Ably incident or a captive portal would
 * otherwise hold the reader on a disabled Log out button for about half a
 * minute. Signing out is the more urgent of the two.
 */
const RELEASE_TIMEOUT_MS = 5_000;

/**
 * Waits for a release, and lets the caller go when the cap runs out.
 *
 * Shared by both paths, because both have a step that leaves the machine: the
 * sign-out has Ably's two REST calls, and the deletion has the chunk fetch its
 * dynamic import needs. A caller held on either has already done the part that
 * stops delivery.
 *
 * The release must carry its own rejection handler. The cap can let the caller
 * go first, and a rejection that lands after that has no one left to catch it.
 */
async function waitForRelease(release: Promise<void>): Promise<void> {
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    release,
    new Promise<void>((resolve) => {
      capTimer = setTimeout(resolve, RELEASE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(capTimer);
}

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
    await waitForRelease(
      deactivatePush(userId).catch((error) => {
        console.error("Failed to release the push device on sign out", error);
      }),
    );
  } catch (error) {
    // Signing out must not fail because Ably did. The registration is then
    // still live, and the reader can clear it from the browser's own site
    // data. Signing back in and pressing a Push cell also resubscribes this
    // browser, which replaces the registration rather than adding one.
    console.error("Failed to release the push device on sign out", error);
  }
}

/**
 * Drop this browser's push subscription once an account deletion has gone
 * through.
 *
 * Deleting the account takes the publish gate with it, so no banner can reach
 * the wrong reader. What stays behind is the browser's own subscription, which
 * the account page reads: the next reader to sign in on this browser would
 * find the Push cell on over a subscription that belongs to a deleted account.
 *
 * Runs after the deletion, not before it. Deletion asks for a password and can
 * be blocked, and releasing first would turn push off for an account that
 * still exists.
 *
 * That order gives up the Ably half, which mints a token and needs the session
 * the deletion just ended. Only the browser unsubscribe is left, and that is
 * the step that stops delivery and clears the cell, which is why the name says
 * so. Ably prunes a device whose endpoint stops answering.
 *
 * Capped like the sign-out, for a different step. `unsubscribe()` resolves
 * before its own request to the push service, so that one cannot hang; the
 * dynamic import below can, because the chunk it names carries the Ably SDK
 * and has to be fetched. The account is already deleted by then, so a reader
 * left waiting on it would sit on the account page of an account that no
 * longer exists, with the button still disabled, until they reloaded.
 *
 * What stays is Ably's own identity token in this browser's storage. The next
 * reader heals it either way: a sign-out reads it and releases the device with
 * their own session, and an activation that finds no subscription deactivates
 * and goes round again (`activatePush`).
 */
export async function dropBrowserPushSubscriptionOnAccountDeletion(): Promise<void> {
  try {
    // Both reads are local, so a reader who never enabled push pays nothing
    // and never loads the Ably SDK on their way out.
    if (!isPushSupported() || !(await hasWebPushSubscription())) {
      return;
    }

    await waitForRelease(
      dropSubscription().catch((error) => {
        console.error(
          "Failed to release the push device after account deletion",
          error,
        );
      }),
    );
  } catch (error) {
    // The account is already gone, so there is nothing to fail back to. The
    // subscription is then still live, and the reader can clear it from the
    // browser's own site data.
    console.error(
      "Failed to release the push device after account deletion",
      error,
    );
  }
}

/** The drop, with the chunk fetch its import needs folded into one promise. */
async function dropSubscription(): Promise<void> {
  const { dropBrowserPushSubscription } = await import(
    "./push-activation.client"
  );
  await dropBrowserPushSubscription();
}
