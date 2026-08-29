"use client";

import { makeUserNotificationsChannelName } from "@sokosumi/utils";
import type Ably from "ably";

import {
  getExistingNotificationServiceWorker,
  hasWebPushSubscription,
} from "@/lib/utils/notification-service-worker";

import { getAblyRealtimeClient } from "./realtime-singleton.client";

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
  const restorePermissionRequest = answerPermissionFromStoredValue();
  try {
    const client = getAblyRealtimeClient();
    await subscribeThisDevice(client, userId);
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

    if (!(await hasWebPushSubscription())) {
      throw new Error("The browser created no push subscription");
    }
  } finally {
    restorePermissionRequest();
  }
}

/**
 * The browser's own request, held while the stand-in answers for it, and how
 * many activations are holding it.
 *
 * Both live at module scope because two activations can overlap: a reader can
 * work the account switch and the device switch inside one page. Saving the
 * previous value per call, the second call would save the first call's
 * stand-in as if it were the browser's own, and the last release would install
 * that stand-in for good. The page could then never prompt again, so a reader
 * who had not answered yet would silently never get push.
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
 * settings switch reads that subscription, so it has to go too, or the switch
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
  const failures: unknown[] = [];
  const client = getAblyRealtimeClient();

  await attempt(failures, dropBrowserPushSubscription);
  // Unsubscribing the device before deactivating keeps Ably from holding a
  // channel subscription for a device it no longer knows.
  await attempt(failures, () =>
    getNotificationsPushChannel(client, userId).unsubscribeDevice(),
  );
  // Runs even when that unsubscribe did not. This is the call that clears
  // `ably.push.deviceIdentityToken`, which is what the next sign-out reads to
  // decide whether this browser has anything left to release.
  await attempt(failures, () => client.push.deactivate());

  if (failures.length > 0) {
    throw failures[0];
  }
}

/** Records a rejection instead of letting it skip the steps that follow. */
async function attempt(
  failures: unknown[],
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    failures.push(error);
  }
}

async function dropBrowserPushSubscription(): Promise<void> {
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
  return client.channels.get(makeUserNotificationsChannelName(userId)).push;
}
