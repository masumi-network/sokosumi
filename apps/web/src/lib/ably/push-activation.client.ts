"use client";

import { makeUserNotificationsChannelName } from "@sokosumi/utils";
import type Ably from "ably";

import {
  getExistingNotificationServiceWorker,
  hasWebPushSubscription,
} from "@/lib/utils/notification-service-worker";

import { getAblyRealtimeClient } from "./realtime-singleton.client";

/**
 * Turn closed-app push on for this browser (ADR-0017).
 *
 * `activate()` asks for the OS notification permission, registers the service
 * worker, and registers the device with Ably. Call it only from an explicit
 * user gesture, or the browser rejects the permission prompt. `subscribeDevice`
 * then binds the device to the reader's own notifications channel, which is the
 * channel Core publishes the push payload on.
 */
export async function activatePush(userId: string): Promise<void> {
  const client = getAblyRealtimeClient();
  await subscribeThisDevice(client, userId);
  if (await hasWebPushSubscription()) {
    return;
  }

  // `activate()` short-circuits when Ably's own stored state already says this
  // browser is activated: in `ably@2.28.0` that state answers `CalledActivate`
  // by calling the activated callback and nothing else (`build/push.js:850`).
  // A browser whose subscription was cleared underneath it therefore reports
  // success without ever subscribing. Clear that state and go round once, so
  // the reader never gets a success toast over a browser that gets no pushes.
  await client.push.deactivate();
  await subscribeThisDevice(client, userId);

  if (!(await hasWebPushSubscription())) {
    throw new Error("The browser created no push subscription");
  }
}

async function subscribeThisDevice(
  client: Ably.Realtime,
  userId: string,
): Promise<void> {
  await client.push.activate();
  await getNotificationsPushChannel(client, userId).subscribeDevice();
}

/**
 * Turn push off again. Unsubscribing before deactivating keeps Ably from
 * holding a subscription for a device it no longer knows.
 *
 * `deactivate()` drops Ably's own device record but leaves the browser's push
 * subscription in place: `ably@2.28.0` touches `pushManager` only to register
 * and subscribe (`build/push.js:223`, `:229`), never to unsubscribe. The
 * settings switch reads that subscription, so it has to go too, or the switch
 * reads on again after a reload.
 */
export async function deactivatePush(userId: string): Promise<void> {
  const client = getAblyRealtimeClient();
  await getNotificationsPushChannel(client, userId).unsubscribeDevice();
  await client.push.deactivate();

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
