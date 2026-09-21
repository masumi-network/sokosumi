"use client";

import type Ably from "ably";
import * as z from "zod";

import {
  forgetNotificationServiceWorker,
  getExistingNotificationServiceWorker,
} from "@/lib/utils/notification-service-worker";

import { getPushTeardownVersion } from "./push-work-queue.client";

const DATABASE_NAME = "sokosumi.push.renewal";
const STORE_NAME = "device";
const RECORD_KEY = "current";

const localDeviceSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  deviceIdentityToken: z.string(),
  push: z.object({ recipient: z.object({ publicVapidKey: z.string() }) }),
});

interface PushRenewalDevice {
  generation: string;
  userId: string;
  deviceId: string;
  deviceIdentityToken: string;
  endpoint: string;
  publicVapidKey: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Push renewal storage is blocked"));
  });
}

async function writeSnapshot(device: PushRenewalDevice | null): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (device) store.put(device, RECORD_KEY);
      else store.delete(RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** Called while activation holds the shared push lock. */
export async function rememberPushRenewal(
  client: Ably.Rest,
  userId: string,
  teardownVersion: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const parsed = localDeviceSchema.safeParse(await client.getDevice());
  if (!parsed.success) return;
  const device = parsed.data;
  const registration = await getExistingNotificationServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  const publicVapidKey = device.push.recipient?.publicVapidKey;
  if (
    !subscription ||
    !device.deviceIdentityToken ||
    !device.clientId?.startsWith(`${userId}:`) ||
    typeof publicVapidKey !== "string" ||
    getPushTeardownVersion() !== teardownVersion
  )
    return;
  await writeSnapshot({
    generation: crypto.randomUUID(),
    userId,
    deviceId: device.id,
    deviceIdentityToken: device.deviceIdentityToken,
    endpoint: subscription.endpoint,
    publicVapidKey,
  });
  // No newer activation can write while this call holds the shared lock.
  if (getPushTeardownVersion() !== teardownVersion) {
    await writeSnapshot(null).catch(stopBrowserDelivery);
  }
}

async function stopBrowserDelivery(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  // Read and unsubscribe before unregistering. Unregister also deactivates
  // this registration's push subscription, so a read after it answers null
  // and an unsubscribe after it answers false. Either leaves the check below
  // blind to a subscription that outlived the teardown.
  const subscription = await registration.pushManager.getSubscription();
  const unsubscribed = await subscription?.unsubscribe().catch(() => false);
  // Unregister runs whatever the unsubscribe said, because it is the step
  // that stops delivery on its own.
  forgetNotificationServiceWorker();
  const unregistered = await registration.unregister();
  if (!unregistered || (subscription && !unsubscribed))
    throw new Error("Could not stop browser push delivery");
}

/** Revoke before remote teardown, including logout's early return and timeout. */
export async function revokePushRenewal(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await writeSnapshot(null);
  } catch {
    // Do not wait behind an activation whose browser subscribe may never finish.
    await stopBrowserDelivery().catch((error) =>
      // Reported rather than thrown. Every caller awaits this before it
      // deactivates the Ably device, so a throw here would leave the device
      // registered and push arriving for a reader who has signed out.
      console.error("Failed to stop browser push delivery", error),
    );
  }
}
