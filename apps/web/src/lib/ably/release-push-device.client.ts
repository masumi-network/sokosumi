"use client";

import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";

import { isPushWorkPending, notePushTeardown } from "./push-work-queue.client";

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
 * `healPushSubscription` repairs that case: a subscription can die on its own
 * (permission revoked, storage cleared, a half-failed disable) while Ably's
 * registration stays. That device is still subscribed to the previous reader's
 * notifications channel, and the next reader's activation reuses the same id
 * and adds their channel beside it, so one browser ends up delivering both.
 * Releasing on the registration too is what stops that.
 */
export function hasAblyPushRegistration(): boolean {
  try {
    return localStorage.getItem(ABLY_DEVICE_IDENTITY_TOKEN_KEY) !== null;
  } catch {
    // Reading storage throws outright where the browser blocks site data.
    return false;
  }
}

/**
 * Forget that this browser was ever registered.
 *
 * The token is what `healPushSubscription` reads to decide that a browser
 * with no subscription once had one, so it must not outlive a decision to
 * turn push off. `client.push.deactivate()` clears it, but only when it
 * lands: a failed call, or one a cap cuts short, leaves the token behind and
 * the browser looks like one that lost its subscription on its own. Removing
 * it here cannot fail on the network. What is left behind is a device record
 * on Ably, which its own delivery prunes once the endpoint stops answering.
 */
export function forgetAblyPushRegistration(): void {
  try {
    localStorage.removeItem(ABLY_DEVICE_IDENTITY_TOKEN_KEY);
    localStorage.removeItem(PUSH_TEARDOWN_STARTED_KEY);
  } catch {
    // Writing storage throws outright where the browser blocks site data.
    // Such a browser carries no token to begin with.
  }
}

/**
 * That a reader asked for push off and nobody saw it through.
 *
 * Written before the teardown runs and removed when the registration is
 * forgotten, so it outlives only a teardown the page did not finish: a reload
 * or a closed tab in the middle of one. The token is still in storage then,
 * beside a browser with no subscription, which is exactly the shape the repair
 * on open looks for. Without this it would read an interrupted disable as a
 * subscription that died by itself and turn push back on.
 *
 * Cleared by a deliberate activation as well, because that is the reader
 * saying the opposite. Nothing else clears it: an interrupted disable should
 * go on reading as off. Storage is shared by every tab of this origin, while
 * the ordering that protects a teardown is per tab, so an activation in one
 * tab answers a note another tab wrote. Usually that is the reader asking for
 * push on, which is the answer either way. The repair asks for it too, and
 * nobody pressed anything for that one.
 */
const PUSH_TEARDOWN_STARTED_KEY = "sokosumi.push.teardownStarted";

/**
 * Say that a teardown has begun, before anything that can be interrupted.
 *
 * A write that does not land takes the token with it. A browser that blocks
 * site data carries no token either, so there is nothing to do there; a
 * browser whose storage is full does, and reads it back perfectly well. The
 * note is what keeps that token from reading as a repair, so a token without
 * one is worse than no token at all: the teardown is trying to take it away
 * in any case.
 */
export function notePushTeardownStarted(): void {
  try {
    localStorage.setItem(PUSH_TEARDOWN_STARTED_KEY, "1");
  } catch {
    forgetAblyPushRegistration();
  }
}

/** Say that the reader wants push on here, whatever they asked for before. */
export function forgetUnfinishedPushTeardown(): void {
  try {
    localStorage.removeItem(PUSH_TEARDOWN_STARTED_KEY);
  } catch {
    // As above.
  }
}

/** Whether a teardown was asked for and never seen through. */
export function hasUnfinishedPushTeardown(): boolean {
  try {
    return localStorage.getItem(PUSH_TEARDOWN_STARTED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * How long a release is waited on before the caller goes anyway.
 *
 * The browser unsubscribe leads and does not wait on the network, so this
 * sheds the Ably half whenever the release has got that far. On the sign-out
 * it can shed the whole release, because that one waits its turn behind
 * whatever is already changing this browser's push state. Usually that run
 * lands later in the same page. A run that never settles holds the queue and
 * it never lands at all, which is what a `pushManager.subscribe()` against an
 * unreachable push service does (`push-work-queue.client.ts`).
 *
 * `PushSubscription.unsubscribe()` deactivates
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
 * dynamic import needs. The sign-out can also be waiting its turn behind a
 * run that is already changing this browser's push state, and a caller shed
 * there has not stopped delivery yet.
 *
 * What covers the sign-out during the wait is not this function, and it is
 * not the token either: forgetting a token unsubscribes nothing, and both
 * paths forget theirs on a line a throw can skip. It is the note. That is
 * written before the teardown is queued, so a reader who closes the tab two
 * seconds into the wait leaves a token behind with a note beside it, and the
 * repair on the next open reads a teardown nobody finished rather than a
 * browser to bring back. An activation the teardown overtook undoes its own
 * work as well, on the way out.
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

    // Asked before the reads below, because it says whether they can be
    // believed. An activation clears both the subscription and the token
    // halfway through, so a reader signing out in that window reads a browser
    // that never had push and leaves the run to resubscribe it behind them.
    if (
      !isPushWorkPending() &&
      !(await hasWebPushSubscription()) &&
      !hasAblyPushRegistration()
    ) {
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

    // Whether the release landed or the cap cut it, this browser is not one
    // the reader wants push on. Say so locally, so nothing later reads the
    // token as a registration that died by itself.
    forgetAblyPushRegistration();
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
 * Ably's own identity token is dropped with it. Keeping it was safe while the
 * only thing that read it was a reader doing something deliberate. The repair
 * on open reads it too, and reads a token beside a browser with no
 * subscription as a subscription that died by itself, so keeping it would
 * hand this browser back to a deleted account. What stays is the device
 * record on Ably, which its own delivery prunes.
 */
export async function dropBrowserPushSubscriptionOnAccountDeletion(): Promise<void> {
  try {
    // Said before anything is read, and whatever the reads would have said.
    // A token beside a browser with no subscription is the one shape
    // `healPushSubscription` treats as a subscription that died by itself,
    // and it answers that by subscribing again. That shape is not the case
    // this skips over, it is the case it has to clear: a browser whose
    // subscription had already died keeps its token, and the next reader to
    // sign in here gets push turned on for them over a deleted account's
    // device. Both calls are local and cannot fail on the network.
    notePushTeardown();
    forgetAblyPushRegistration();

    // Both reads are local too, so a reader who never enabled push pays
    // nothing and never loads the Ably SDK on their way out.
    if (!isPushSupported() || !(await hasWebPushSubscription())) {
      return;
    }

    // Run rather than queued, unlike every other change to this browser's
    // push state. An activation can be pending here, and waiting its turn
    // behind one would hand a hung `client.push.activate()` the power to stop
    // a deletion from unsubscribing at all, for the life of the page, and
    // signing in again never reloads it.
    //
    // What that costs is real rather than narrow. An activation still running
    // is not stopped by the session ending: it registers on the Ably token the
    // client already holds, and can put back everything this just took. The
    // answer to that is in the activation rather than here, which is why the
    // count above is noted before anything else. It reads that count and
    // undoes itself when a teardown overtook it.
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
