import * as z from "zod";

import type { NotificationEventData } from "@/lib/ably/schema";
import { notificationEventDataSchema } from "@/lib/ably/schema";

import { getBrowserNotificationPermission } from "./browser-notification";

/**
 * The worker that renders every OS banner this app shows (ADR-0020).
 *
 * It lives in `public/`, so its scope is the whole origin. Ably passes the
 * same URL as `pushServiceWorkerUrl` and registers it inside `push.activate()`;
 * registering it here as well gives readers who never turn push on a
 * registration to render through. Both calls name one URL and one scope, so
 * the second is a no-op.
 */
export const NOTIFICATION_SERVICE_WORKER_URL = "/ably-push-sw.js";

/**
 * Icon on every banner. The worker carries its own copy for pushes, and a
 * drift test holds the two to this value, which is why it is exported.
 */
export const NOTIFICATION_ICON_PATH = "/images/app-icons/apple-icon-180.png";

/** Sent by the worker when a reader clicks one of its banners. */
export const NOTIFICATION_CLICK_MESSAGE = "sokosumi:notification-click";

/**
 * Asked by the worker before it skips a banner, to learn whether the focused
 * page shows notifications in the app itself. Only pages that mount the
 * notification listener answer.
 */
export const SHOWS_NOTIFICATIONS_QUERY = "sokosumi:shows-notifications";

/**
 * What a banner has to carry for a click to reach its destination: the fields
 * `handleNotificationNavigation` reads, plus the id to mark read.
 *
 * The banner carries it rather than the page, because the page that rendered a
 * banner is not always the page that receives its click. The worker posts to
 * the tab it focused, a push can replace a banner another tab rendered, and on
 * WebKit a push displays while the focused tab rendered nothing at all.
 */
export const notificationTargetSchema = notificationEventDataSchema
  .pick({
    id: true,
    kind: true,
    referenceId: true,
    messageKey: true,
    metadata: true,
  })
  // A banner with no id can neither be marked read nor deduped by tag.
  .extend({ id: z.string().min(1) });

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

/**
 * The target a realtime event routes to. It sits next to the schema so a field
 * added above is added here too, rather than in whichever page happens to
 * render a banner. The worker builds the same shape from push data in
 * `buildTarget`, and a test holds the two to the schema's field list.
 */
export function toNotificationTarget(
  notification: NotificationEventData,
): NotificationTarget {
  const { id, kind, referenceId, messageKey, metadata } = notification;
  return { id, kind, referenceId, messageKey, metadata };
}

const showsNotificationsQuerySchema = z.object({
  type: z.literal(SHOWS_NOTIFICATIONS_QUERY),
});

const clickMessageSchema = z.object({
  type: z.literal(NOTIFICATION_CLICK_MESSAGE),
  target: notificationTargetSchema,
});

export interface ShowNotificationInput {
  title: string;
  body: string;
  target: NotificationTarget;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null =
  null;

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/**
 * Whether this browser could become a push device: the push API, a service
 * worker to receive through, and a Notification API to render with. False on
 * an iOS Safari tab outside the installed web app, and on a desktop browser
 * old enough to predate Web Push.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "PushManager" in window &&
    isServiceWorkerSupported() &&
    getBrowserNotificationPermission() !== "unsupported"
  );
}

async function register(): Promise<ServiceWorkerRegistration | null> {
  try {
    const registration = await navigator.serviceWorker.register(
      NOTIFICATION_SERVICE_WORKER_URL,
    );
    // A registration that is installing cannot show anything yet.
    return registration.active ? registration : navigator.serviceWorker.ready;
  } catch (error) {
    console.error("Failed to register the notification service worker", error);
    return null;
  }
}

/**
 * Registers the worker once per page and reuses that registration after. A
 * failed attempt is not cached: caching it would cost the tab every later
 * banner over one bad moment.
 */
export function getNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    return Promise.resolve(null);
  }

  registrationPromise ??= register().then((registration) => {
    if (!registration) {
      registrationPromise = null;
    }
    return registration;
  });

  return registrationPromise;
}

/**
 * The worker if it is already registered, without registering one. Reading
 * whether this browser is subscribed, or dropping that subscription, must not
 * install a worker as a side effect.
 */
export async function getExistingNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    return null;
  }

  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** Whether this browser holds a live Web Push subscription. */
export async function hasWebPushSubscription(): Promise<boolean> {
  const registration = await getExistingNotificationServiceWorker();
  if (!registration) {
    return false;
  }

  try {
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Shows an OS banner through the worker. Callers must gate with
 * `shouldShowBrowserNotification` first.
 *
 * `tag` is the notification id, so the banner a push renders for the same
 * notification replaces this one in place instead of stacking beside it.
 * Returns false when nothing was shown.
 */
export async function showNotification({
  title,
  body,
  target,
}: ShowNotificationInput): Promise<boolean> {
  if (getBrowserNotificationPermission() !== "granted") {
    return false;
  }

  const registration = await getNotificationServiceWorker();
  if (!registration) {
    return false;
  }

  try {
    await registration.showNotification(title, {
      body,
      tag: target.id,
      icon: NOTIFICATION_ICON_PATH,
      data: target,
    });
    return true;
  } catch (error) {
    console.error("Failed to show the notification", error);
    return false;
  }
}

/**
 * Answers the worker's "does this page show notifications?" query for as long
 * as the caller stays mounted.
 *
 * The worker skips its own banner on a focused page only when that page
 * answers yes, so a focused tab showing a share link or the sign-in page still
 * gets a banner instead of silence. `showsNotifications` is read at answer
 * time rather than at subscribe time, because a page that mounts the listener
 * can still stop receiving while it sits there.
 */
export function answerShowsNotificationsQuery(
  showsNotifications: () => boolean,
): () => void {
  return subscribeToServiceWorkerMessages((event) => {
    if (showsNotificationsQuerySchema.safeParse(event.data).success) {
      event.ports[0]?.postMessage(showsNotifications());
    }
  });
}

/**
 * Calls `onClick` when a reader clicks a banner the worker rendered. The
 * worker owns the click because a banner it shows outlives the page that
 * asked for it.
 */
export function subscribeNotificationClicks(
  onClick: (target: NotificationTarget) => void,
): () => void {
  return subscribeToServiceWorkerMessages((event) => {
    const message = clickMessageSchema.safeParse(event.data);
    if (message.success) {
      onClick(message.data.target);
    }
  });
}

/** Listens for worker messages, and returns the call that stops listening. */
function subscribeToServiceWorkerMessages(
  handleMessage: (event: MessageEvent) => void,
): () => void {
  if (!isServiceWorkerSupported()) {
    return () => {};
  }

  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => {
    navigator.serviceWorker.removeEventListener("message", handleMessage);
  };
}
