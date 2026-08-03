const SERVICE_WORKER_PATH = "/sw.js";

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/**
 * Register the push service worker (idempotent).
 */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  } catch (error) {
    console.error("Failed to register push service worker:", error);
    return null;
  }
}

/**
 * Ensure SW is registered and ready, then return the registration.
 */
export async function getPushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  const existing =
    await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  if (existing) {
    return existing;
  }

  return registerPushServiceWorker();
}

/**
 * Convert a VAPID public key (base64url) to a Uint8Array for PushManager.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = globalThis.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SerializedPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function serializePushSubscription(
  subscription: PushSubscription,
): SerializedPushSubscription | null {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    // Fallback via getKey when toJSON omits keys (rare).
    const p256dhKey = subscription.getKey("p256dh");
    const authKey = subscription.getKey("auth");
    if (!p256dhKey || !authKey) {
      return null;
    }
    return {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToBase64Url(p256dhKey),
        auth: arrayBufferToBase64Url(authKey),
      },
    };
  }

  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

export async function getLocalPushSubscription(): Promise<PushSubscription | null> {
  const registration = await getPushServiceWorkerRegistration();
  if (!registration) {
    return null;
  }

  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function hasLocalPushSubscription(): Promise<boolean> {
  const subscription = await getLocalPushSubscription();
  return subscription !== null;
}

/**
 * Subscribe the current browser to Web Push with the given VAPID public key.
 */
export async function subscribeLocalPush(
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const registration = await getPushServiceWorkerRegistration();
  if (!registration) {
    throw new Error("service_worker_unavailable");
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

/**
 * Unsubscribe the current browser PushSubscription if present.
 */
export async function unsubscribeLocalPush(): Promise<string | null> {
  const subscription = await getLocalPushSubscription();
  if (!subscription) {
    return null;
  }

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
