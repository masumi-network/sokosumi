import { coreClient } from "@/lib/clients/core.browser.client";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from "@/lib/utils/browser-notification";
import {
  getLocalPushSubscription,
  hasLocalPushSubscription,
  isWebPushSupported,
  registerPushServiceWorker,
  serializePushSubscription,
  subscribeLocalPush,
  unsubscribeLocalPush,
} from "@/lib/utils/web-push";

export type EnablePushResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "permission_denied"
        | "subscribe_failed"
        | "persist_failed";
    };

export type DisablePushResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "disable_failed" };

/**
 * Register the push SW when a local subscription already exists so closed-tab
 * pushes keep working after reload.
 */
export async function ensurePushServiceWorkerIfSubscribed(): Promise<void> {
  if (!isWebPushSupported()) {
    return;
  }

  const registration = await registerPushServiceWorker();
  if (!registration) {
    return;
  }

  try {
    await registration.pushManager.getSubscription();
  } catch {
    // Presence check only; registration itself is enough for push delivery.
  }
}

export async function isPushEnabledLocally(): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }
  return hasLocalPushSubscription();
}

/**
 * Opt in: request permission → subscribe → POST Core.
 * Rolls back local unsubscribe if Core POST fails.
 */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!isWebPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  let permission = getBrowserNotificationPermission();
  if (permission === "default") {
    permission = await requestBrowserNotificationPermission();
  }

  if (permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  let vapidPublicKey: string;
  try {
    const response = await coreClient.getPushVapidPublicKey();
    vapidPublicKey = response.data.publicKey;
  } catch (error) {
    console.error("Failed to fetch VAPID public key:", error);
    return { ok: false, reason: "persist_failed" };
  }

  let subscription: PushSubscription;
  try {
    subscription = await subscribeLocalPush(vapidPublicKey);
  } catch (error) {
    console.error("Failed to subscribe to push:", error);
    return { ok: false, reason: "subscribe_failed" };
  }

  const serialized = serializePushSubscription(subscription);
  if (!serialized) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Best-effort rollback.
    }
    return { ok: false, reason: "subscribe_failed" };
  }

  try {
    await coreClient.upsertPushSubscription(serialized);
  } catch (error) {
    console.error("Failed to persist push subscription:", error);
    try {
      await subscription.unsubscribe();
    } catch {
      // Best-effort rollback.
    }
    return { ok: false, reason: "persist_failed" };
  }

  return { ok: true };
}

/**
 * Opt out: DELETE Core first, then local unsubscribe.
 * Still unsubscribes locally if DELETE fails.
 */
export async function disablePushNotifications(): Promise<DisablePushResult> {
  if (!isWebPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  const local = await getLocalPushSubscription();
  if (!local) {
    return { ok: true };
  }

  const endpoint = local.endpoint;

  try {
    await coreClient.deletePushSubscription({ endpoint });
  } catch (error) {
    console.error("Failed to delete push subscription on Core:", error);
  }

  try {
    await unsubscribeLocalPush();
  } catch (error) {
    console.error("Failed to unsubscribe local push:", error);
    return { ok: false, reason: "disable_failed" };
  }

  return { ok: true };
}
