"use client";

import type Ably from "ably";

import {
  getExistingNotificationServiceWorker,
  hasWebPushSubscription,
} from "@/lib/utils/notification-service-worker";

import { makeCurrentUserNotificationsChannelName } from "./current-notifications-channel.client";
import {
  countPushTeardowns,
  notePushTeardown,
  queuePushWork,
} from "./push-work-queue.client";
import { getAblyRealtimeClient } from "./realtime-singleton.client";
import {
  forgetAblyPushRegistration,
  forgetUnfinishedPushTeardown,
  notePushTeardownStarted,
} from "./release-push-device.client";

/**
 * Turn closed-app push on for this browser (ADR-0022).
 *
 * `activate()` registers the service worker and registers the device with
 * Ably. It asks the reader for nothing: `answerPermissionFromStoredValue`
 * answers the SDK's own permission request from `Notification.permission` for
 * the duration, so the caller has to hold the permission already.
 * `subscribeDevice` then binds the device to the reader's own notifications
 * channel, which is the channel Core publishes the push payload on.
 */
export async function activatePush(userId: string): Promise<void> {
  // The reader is asking for push on, which answers any teardown this browser
  // was left in the middle of. Said here rather than after the run, because
  // what it clears is a note that would otherwise outlast a run this page
  // does not finish either.
  forgetUnfinishedPushTeardown();

  // The same reader asking twice gets the run already going. A repair on open
  // and a reader pressing the Push cell a second later are the same request.
  if (inFlightActivation?.userId === userId) {
    return inFlightActivation.work;
  }

  // A second reader waits rather than joins. Signing in again never reloads
  // the page, so this module outlives the reader it ran for, and joining
  // would answer the second reader with the first reader's subscription.
  const entry = { userId, work: queuePushWork(() => runActivation(userId)) };
  inFlightActivation = entry;

  try {
    await entry.work;
  } finally {
    // Only when this run is still the one on record. A later reader's
    // activation is already waiting behind this one, and clearing their entry
    // would leave them a run of their own queued behind it for nothing.
    if (inFlightActivation === entry) {
      inFlightActivation = null;
    }
  }
}

/** The activation running now, and the reader it is running for. */
let inFlightActivation: { userId: string; work: Promise<void> } | null = null;

async function runActivation(userId: string): Promise<void> {
  // Read before anything, and asked again after every step that leaves the
  // machine. A teardown can land in the middle of this: the sign-out waits
  // its turn in the queue, but an account deletion cannot afford to and runs
  // straight through. Either way the token this run writes would be written
  // after the teardown forgot it, and `client.push.activate()` does not need
  // a live Sokosumi session to get that far. It registers on the Ably token
  // the client already holds, minted with no ttl and so good for Ably's
  // default hour (`create-token-request.ts`), and the SDK writes the identity
  // token back from its own state machine (`ably@2.28.0 build/push.js:840`).
  // Without this read, a deletion racing an activation ends with the browser
  // subscribed, an Ably device on the deleted reader's channel, and the token
  // back in storage.
  const teardownsAtStart = countPushTeardowns();
  const restorePermissionRequest = answerPermissionFromStoredValue();
  try {
    const client = getAblyRealtimeClient();
    await subscribeThisDevice(client, userId);
    if (await abandonedToTeardown(teardownsAtStart)) {
      return;
    }

    if (await hasWebPushSubscription()) {
      return;
    }

    // `activate()` short-circuits when Ably's own stored state already says
    // this browser is activated: in `ably@2.28.0` that state answers
    // `CalledActivate` by calling the activated callback and nothing else
    // (`build/push.js:850`). A browser whose subscription was cleared
    // underneath it therefore reports success without ever subscribing. Clear
    // that state and go round once, so the reader never gets a success toast
    // over a browser that gets no pushes.
    await client.push.deactivate();
    await subscribeThisDevice(client, userId);
    if (await abandonedToTeardown(teardownsAtStart)) {
      return;
    }

    if (!(await hasWebPushSubscription())) {
      throw new Error("The browser created no push subscription");
    }
  } finally {
    restorePermissionRequest();
  }
}

/**
 * Whether a teardown landed while this activation was away, and undoes it.
 *
 * The reader asked for push off after asking for it on, so off is the answer.
 * What this run left behind is what a teardown would have taken: the
 * subscription it just made and the identity token the SDK wrote back. Both
 * go, in that order, because the unsubscribe is the one that stops delivery.
 *
 * The Ably device record stays. Deregistering it needs the session that a
 * deletion has already ended, and Ably prunes a device whose endpoint stops
 * answering.
 */
async function abandonedToTeardown(teardownsAtStart: number): Promise<boolean> {
  if (countPushTeardowns() === teardownsAtStart) {
    return false;
  }

  // Awaited, not left running. `dropBrowserPushSubscription` reads the
  // registration and the subscription when it runs rather than when it is
  // called, so an undo let go of here finishes whenever those two reads
  // finish: after this run returns, after the queue advances, and possibly
  // after a later reader has pressed the Push cell and been subscribed. It
  // would then read that reader's subscription and unsubscribe it, leaving
  // the cell reading on over a browser that gets nothing. Awaiting costs
  // only the queue, which serialises this work in any case.
  try {
    await dropBrowserPushSubscription();
  } catch (error) {
    console.error("Failed to undo an activation a teardown overtook", error);
  }

  forgetAblyPushRegistration();

  return true;
}

/**
 * The browser's own request, held while the stand-in answers for it, and how
 * many activations are holding it.
 *
 * Both live at module scope because the stand-in is installed globally.
 * Saving the previous value per call, a second call while the first still
 * held it would save the first call's stand-in as if it were the browser's
 * own, and the last release would install that stand-in for good. The page
 * could then never prompt again, so a reader who had not answered yet would
 * silently never get push.
 *
 * `activatePush` now runs one activation at a time, so no second call reaches
 * this. The count stays because the cost of being wrong about that is a
 * browser that can never prompt again.
 */
let nativeRequestPermission: typeof Notification.requestPermission | null =
  null;
let permissionStubDepth = 0;

/**
 * Stops `ably@2.28.0` asking for the notification permission a second time,
 * and returns the call that puts the browser's own request back.
 *
 * `getW3CPushDeviceDetails` opens with `await Notification.requestPermission()`
 * and fails the activation on anything but `granted` (`build/push.js:194`).
 * WebKit answers `denied` to a request that does not run inside the user
 * gesture, and Ably's `activate()` awaits `getDevice()` and
 * `ensureInitialized()` before it ever reaches that line (`build/ably.js:3239`),
 * so on an installed iOS web app the gesture is always gone by then. The
 * reader saw `User denied permission to send notifications` while the stored
 * permission read `granted`.
 *
 * Ably's own fix is to request only while the permission is still `default`
 * (https://github.com/ably/ably-js/pull/2071, open since 2025-08-19 and
 * unreleased as of `2.28.0`). The caller has already asked inside the gesture,
 * so answer from the stored permission and prompt nothing. This tells the SDK
 * the truth; it only declines to re-prompt. Delete it when that PR ships.
 */
function answerPermissionFromStoredValue(): () => void {
  if (typeof Notification === "undefined") {
    return () => {};
  }

  if (permissionStubDepth === 0) {
    nativeRequestPermission = Notification.requestPermission;
    Notification.requestPermission = () =>
      Promise.resolve(Notification.permission);
  }
  permissionStubDepth += 1;

  // Idempotent, so a caller that releases twice cannot end another caller's
  // hold and leave Ably free to prompt in the middle of it.
  let released = false;
  return () => {
    if (released) {
      return;
    }

    released = true;
    permissionStubDepth -= 1;
    if (permissionStubDepth === 0 && nativeRequestPermission) {
      Notification.requestPermission = nativeRequestPermission;
      nativeRequestPermission = null;
    }
  };
}

async function subscribeThisDevice(
  client: Ably.Realtime,
  userId: string,
): Promise<void> {
  await client.push.activate();
  await getNotificationsPushChannel(client, userId).subscribeDevice();
}

/**
 * Turn push off again.
 *
 * `deactivate()` drops Ably's own device record but leaves the browser's push
 * subscription in place: `ably@2.28.0` touches `pushManager` only to register
 * and subscribe (`build/push.js:223`, `:229`), never to unsubscribe. The
 * account page reads that subscription, so it has to go too, or a Push cell
 * reads on again after a reload.
 *
 * Every step is attempted, whatever the ones before it did, and the first
 * failure is thrown once they have all had their turn. Chaining them on one
 * `await` meant any single rejection skipped the rest, and the sign-out path
 * swallows what this throws: a step skipped there is a registration nobody
 * comes back to clear.
 *
 * The browser subscription goes first, because it is the only step that
 * actually stops delivery to this browser. Ably is then left holding a device
 * whose endpoint is dead, which its own delivery prunes; the reverse leaves a
 * live endpoint nobody meant to keep.
 */
export async function deactivatePush(userId: string): Promise<void> {
  // Said before anything is queued, because a repair that has decided to act
  // has not queued anything yet either. That is what it reads to find out its
  // subscription is no longer wanted.
  notePushTeardown();

  // Written to storage as well, for the repair on the page after this one.
  // The steps below can be cut short by a reload or a closed tab, and what
  // they leave behind then is a token beside a browser with no subscription:
  // the shape the repair reads as a subscription that died by itself.
  notePushTeardownStarted();

  // Nothing may join the activation ahead of this one, because this undoes
  // it. A reader who turns push back on afterwards is asking for a run of
  // their own, and joining the earlier one would answer them with a
  // subscription this teardown then takes away: the cell reads on and the
  // browser gets nothing.
  inFlightActivation = null;

  return queuePushWork(() => runDeactivation(userId));
}

/**
 * How long the Ably half of a teardown is waited for.
 *
 * `ably@2.28.0` allows each request a 10s timeout on top of 15s of
 * fallback-host retries (`build/ably.js:790-791`), and the teardown makes two,
 * so this sits above what a slow answer costs and below what a page lasts.
 */
const ABLY_TEARDOWN_TIMEOUT_MS = 40_000;

async function runDeactivation(userId: string): Promise<void> {
  const failures: unknown[] = [];

  await attempt(failures, dropBrowserPushSubscription);

  // Ably gets a deadline of its own, because what comes after it must happen.
  // A rejection is recorded and moves on, but a hang is not: two REST calls
  // with the SDK's own retry budget can outlive the page, and the token below
  // would then never be forgotten. Waited out rather than cut short wherever
  // Ably answers at all; the call is left running, and a deregistration that
  // lands late lands anyway. Recorded as a failure because the reader is told
  // the teardown is done, and an abandoned one is not done.
  await withDeadline(
    attempt(failures, () => dropAblyPushDevice(failures, userId)),
    () => {
      failures.push(new Error("The Ably push teardown did not answer"));
    },
  );

  // Said locally as well, because a failed deactivation leaves Ably's token
  // behind and a browser with the token but no subscription is the shape the
  // repair on open looks for. A half-failed disable would come back on.
  //
  // Kept when the browser subscription is still there, because then the
  // browser is still being delivered to and the token is what a later
  // sign-out needs to deregister it. The repair reads the subscription too,
  // so it leaves such a browser alone either way.
  //
  // The browser is asked rather than the step above: a step that threw says
  // it failed, not that a subscription survived it, and the common failure is
  // a service worker lookup that found nothing to unsubscribe. Read the other
  // way round, a browser with no subscription keeps a token the repair on open
  // then reads as an invitation to turn push back on.
  if (!(await hasWebPushSubscription())) {
    forgetAblyPushRegistration();
  }

  if (failures.length > 0) {
    throw failures[0];
  }
}

/**
 * Wait for the work, or stop waiting and say so.
 *
 * The timer is cleared on the way out, so work that answers in a second does
 * not leave a minute of timer behind it.
 */
async function withDeadline(
  work: Promise<unknown>,
  onDeadline: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), ABLY_TEARDOWN_TIMEOUT_MS);
  });

  try {
    if (
      (await Promise.race([work.then(() => "work" as const), deadline])) ===
      "deadline"
    ) {
      onDeadline();
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drop Ably's own device, and the channel subscription that points at it.
 *
 * Records into the caller's list rather than keeping one of its own. Throwing
 * the first failure on would reach the caller's `attempt` and log the same
 * rejection a second time, which reads in triage as two steps failing when
 * one did.
 *
 * Building the client belongs in here rather than on a line above the call.
 * `getAblyRealtimeClient` constructs on its first call and can throw there,
 * and a bare call would both skip the browser endpoint and throw away whatever
 * the step before it had already recorded. That construction is the one throw
 * this function still hands back, and the caller's `attempt` catches it.
 */
async function dropAblyPushDevice(
  failures: unknown[],
  userId: string,
): Promise<void> {
  const client = getAblyRealtimeClient();

  // Unsubscribing the device before deactivating keeps Ably from holding a
  // channel subscription for a device it no longer knows.
  await attempt(failures, () =>
    getNotificationsPushChannel(client, userId).unsubscribeDevice(),
  );
  // Runs even when that unsubscribe did not. This is the call that clears
  // `ably.push.deviceIdentityToken`, which is what the next sign-out reads to
  // decide whether this browser has anything left to release.
  await attempt(failures, () => client.push.deactivate());
}

/**
 * Records a rejection instead of letting it skip the steps that follow.
 *
 * Logs it too, because only the first failure is thrown on and the account
 * page shows one generic message for whatever it gets.
 */
async function attempt(
  failures: unknown[],
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error("A push teardown step failed", error);
    failures.push(error);
  }
}

/**
 * Drop this browser's Web Push subscription.
 *
 * Exported because the account-deletion path needs this half on its own: the
 * session is gone by the time it runs, so Ably's deactivation cannot mint the
 * token it needs, while the browser unsubscribe needs no session and is the
 * step that stops delivery.
 */
export async function dropBrowserPushSubscription(): Promise<void> {
  // Read the registration rather than create one: turning push off must not
  // install a worker. A browser that never had one has nothing to drop.
  const registration = await getExistingNotificationServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

function getNotificationsPushChannel(
  client: Ably.Realtime,
  userId: string,
): Ably.PushChannel {
  return client.channels.get(makeCurrentUserNotificationsChannelName(userId))
    .push;
}
