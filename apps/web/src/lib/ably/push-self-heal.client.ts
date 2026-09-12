"use client";

import { getBrowserNotificationPermission } from "@/lib/utils/browser-notification";
import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";

import { countPushTeardowns } from "./push-work-queue.client";
import {
  hasAblyPushRegistration,
  hasUnfinishedPushTeardown,
} from "./release-push-device.client";

/**
 * Re-subscribe a browser that was set up for push and lost its subscription.
 *
 * A Web Push subscription dies on its own: the push service can expire an
 * endpoint, and a browser can drop it with its site data. Nothing brought it
 * back. Until this ran, every
 * activation sat behind a click on the account page, so a reader whose browser
 * went quiet had to find that page and press the cell again to be reachable,
 * and nothing told them they had to. SOK-876 names this gap.
 *
 * Three conditions, and all of them are read from this browser, so an app open
 * costs no request:
 *
 * Ably still holds a registration for this browser. That is what makes this a
 * repair rather than an opt-in: a browser that never turned push on has no
 * registration, and this leaves it alone. A reader who turned push off has
 * none either, and neither has a browser that signed out. Signing out forgets
 * the registration whatever Ably answered; turning push off forgets it once
 * the browser subscription is gone. Turning push off also waits for a repair
 * already running and then undoes it, so a reader who says no has the last
 * word.
 *
 * One repair per browser is all this can promise. The activation clears
 * Ably's own state halfway through its round, so a repair that fails after
 * that point leaves no registration to read, and this never runs on that
 * browser again. The account page still turns push on.
 *
 * The notification permission is already granted. Subscribing cannot succeed
 * without it, and asking for it is the reader's decision to make on a page
 * they went to, never a prompt on app open.
 *
 * This browser holds no subscription. A browser that has one is already being
 * delivered to and must not be activated again.
 *
 * Never throws and never reports to the reader. This runs on app open with
 * nothing asked for, so the honest outcome of a failure is the state the
 * reader was already in: quiet, and repairable from the account page.
 */
export async function healPushSubscription(userId: string): Promise<boolean> {
  try {
    // Read first of all, before anything this function waits on. Every wait
    // below is a window a sign-out can land in, and the reads around them say
    // nothing about it: the token is still there until the teardown clears it.
    const teardownsBefore = countPushTeardowns();

    if (
      !isPushSupported() ||
      getBrowserNotificationPermission() !== "granted" ||
      !hasAblyPushRegistration() ||
      hasUnfinishedPushTeardown() ||
      (await hasWebPushSubscription())
    ) {
      return false;
    }

    // Loaded here rather than above, so a reader with nothing to repair never
    // pays for the Ably SDK. Same boundary the account page keeps.
    const { activatePush } = await import("./push-activation.client");

    // Nothing of this run was queued while those waits ran, so a sign-out
    // inside one of them tore this browser down and left, with nothing of
    // this run to order itself against. Activating now would subscribe the
    // browser the reader just signed out of. The shared note is the same
    // window in another tab: it can land while this page loads the chunk,
    // and a repair must not answer it. Ordering covers the rest: from here
    // the activation is queued without another wait, and still reads the
    // note again before it subscribes.
    if (
      hasUnfinishedPushTeardown() ||
      countPushTeardowns() !== teardownsBefore
    ) {
      return false;
    }

    await activatePush(userId, { readerInitiated: false });

    return true;
  } catch (error) {
    console.error("Failed to restore the push subscription", error);

    return false;
  }
}
