"use client";

import { getBrowserNotificationPermission } from "@/lib/utils/browser-notification";
import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";
import { getOrCreateAblyClientInstanceId } from "./ably-client-instance-id";
import { fetchAblyBrowserAuthTokenRequest } from "./auth.client";

import {
  hasPushPreference,
  readPushPreferenceUserId,
  rememberPushPreference,
  wantsPushHere,
} from "./push-preference.client";
import {
  revokePushRenewalForUser,
  stopBrowserDelivery,
} from "./push-renewal.client";
import { recordPushRepairOutcome } from "./push-repair-outcome.client";
import {
  getPushTeardownVersion,
  notePushTeardown,
  queuePushWork,
} from "./push-work-queue.client";
import {
  forgetAblyPushRegistration,
  hasAblyPushRegistration,
  hasUnfinishedPushTeardown,
  notePushTeardownStarted,
  readPushDeviceOwner,
} from "./release-push-device.client";

/** Reconcile remembered consent with the browser and Ably after each wake. */
export async function healPushSubscription(userId: string): Promise<boolean> {
  // Read before the repair, and carried past it. `activatePush` clears Ably's
  // stored state halfway through its round, so a repair that fails after that
  // point leaves no registration behind: read again afterwards, the browser
  // this ran for would look like one that never turned push on, and the
  // notice meant for exactly that reader would never appear.
  const teardownVersion = getPushTeardownVersion();
  const hadRegistration = hasAblyPushRegistration();

  let deliveryHealthy: boolean | undefined;
  try {
    deliveryHealthy = await runHeal(userId, hadRegistration);
    return deliveryHealthy === true;
  } finally {
    // Whichever way the repair went, this is the moment the answer is worth
    // reading: a browser still quiet here is one the reader has to be told
    // about, and nothing else in the app knows the repair has settled.
    //
    // Caught here as well, because this sits in a `finally`: a throw from the
    // browser read, the storage write, or any listener would replace the
    // repair's own answer with a rejection, and the only caller runs this as
    // `void healPushSubscription(userId)`. The repair still happened; failing
    // to write down what it left is not a reason to lose that.
    try {
      await recordPushRepairOutcome({
        hadRegistration: hadRegistration || wantsPushHere(userId),
        teardownVersion,
        deliveryHealthy,
      });
    } catch (error) {
      console.error("Failed to record the push repair outcome", error);
    }
  }
}

async function runHeal(
  userId: string,
  hadRegistration: boolean,
): Promise<boolean | undefined> {
  try {
    // Read first of all, before anything this function waits on. Every wait
    // below is a window a sign-out can land in, and the reads around them say
    // nothing about it: the token is still there until the teardown clears it.
    const teardownVersion = getPushTeardownVersion();

    if (
      isPushSupported() &&
      (await stopForeignPushSubscription(userId, hadRegistration))
    ) {
      return false;
    }

    if (
      !isPushSupported() ||
      getBrowserNotificationPermission() !== "granted" ||
      hasUnfinishedPushTeardown() ||
      (hasPushPreference() ? !wantsPushHere(userId) : !hadRegistration)
    ) {
      return false;
    }

    rememberPushPreference(userId);

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
      getPushTeardownVersion() !== teardownVersion
    ) {
      return false;
    }

    return await activatePush(userId, { readerInitiated: false });
  } catch (error) {
    console.error("Failed to restore the push subscription", error);

    return undefined;
  }
}

/** A naturally expired session keeps push, but another account must not inherit it. */
async function stopForeignPushSubscription(
  userId: string,
  hadRegistration: boolean,
): Promise<boolean> {
  function readOwner() {
    return readPushDeviceOwner() ?? readPushPreferenceUserId();
  }
  const owner = readOwner();
  if (!owner || owner === userId) return false;
  if (!hadRegistration && !(await hasWebPushSubscription())) return false;
  const version = getPushTeardownVersion();

  // A stale tab still carries its previous userId. The token checks the current cookie first.
  const clientInstanceId = getOrCreateAblyClientInstanceId();
  const token = await fetchAblyBrowserAuthTokenRequest(clientInstanceId);
  if (
    token.clientId !== `${userId}:${clientInstanceId}` ||
    version !== getPushTeardownVersion() ||
    owner !== readOwner()
  )
    return true;

  if (wantsPushHere(owner)) rememberPushPreference(owner, true);
  notePushTeardown();
  notePushTeardownStarted();
  const teardownVersion = getPushTeardownVersion();
  // Revoke before waiting behind an activation, so the worker cannot renew the old account.
  const renewalRevoked = revokePushRenewalForUser(owner);
  await queuePushWork(async () => {
    const storageRevoked = await renewalRevoked;
    if (teardownVersion !== getPushTeardownVersion() || owner !== readOwner())
      return;
    if (storageRevoked) {
      const { dropBrowserPushSubscription } = await import(
        "./push-activation.client"
      );
      await dropBrowserPushSubscription();
    } else {
      await stopBrowserDelivery();
    }
    forgetAblyPushRegistration();
    notePushTeardownStarted();
  });
  return true;
}
