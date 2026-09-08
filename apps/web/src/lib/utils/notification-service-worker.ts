import * as z from "zod";

import { getEnvPublicConfig } from "@/config/env.public";
import type { NotificationEventData } from "@/lib/ably/schema";
import { notificationEventDataSchema } from "@/lib/ably/schema";
import { NotificationKind } from "@/lib/clients/generated/core";

import { getBrowserNotificationPermission } from "./browser-notification";

/**
 * The worker that renders every OS banner this app shows (ADR-0023).
 *
 * It lives in `public/`, so its scope is the whole origin. Ably passes the
 * same URL as `pushServiceWorkerUrl` and registers it inside `push.activate()`;
 * registering it here as well gives readers who never turn push on a
 * registration to render through. Both calls name one URL and one scope, so
 * the second is a no-op.
 */
export const NOTIFICATION_SERVICE_WORKER_URL = "/ably-push-sw.js";

/** Gives the static worker the stable app URL through its own script URL. */
export function getNotificationServiceWorkerUrl(): string {
  const env = getEnvPublicConfig();
  const appUrl =
    env.NEXT_PUBLIC_VERCEL_ENV === "preview"
      ? env.NEXT_PUBLIC_VERCEL_BRANCH_URL
      : env.NEXT_PUBLIC_VERCEL_ENV === "production"
        ? env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
        : undefined;

  return appUrl
    ? `${NOTIFICATION_SERVICE_WORKER_URL}?appUrl=${encodeURIComponent(appUrl)}`
    : NOTIFICATION_SERVICE_WORKER_URL;
}

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

/**
 * Prefix on a room's banner tag, so a room can never be mistaken for a row.
 *
 * Room ids and notification ids come from one generator, so a bare room id
 * could equal the id of some unrelated notification and silently replace its
 * banner.
 */
const CHAT_GROUP_TAG_PREFIX = "sokosumi-room:";

/**
 * The banner a Notification belongs to.
 *
 * Chat groups by room. A mention, a direct message and the row a room's
 * messages are counted onto all name the same room, so one conversation holds
 * one banner and a new arrival replaces the one standing rather than stacking
 * beside it. That is what a room's counted row already did on its own, by
 * keeping its id across messages; this gives the other two the same behaviour
 * and puts all three in the same group.
 *
 * Everything else is its own banner. A job and a task each interrupt about a
 * thing that happened once, and there is no second one to fold into.
 *
 * The push service worker mirrors this rule, because it renders the banner for
 * a closed app and cannot import from here. The two must agree, or the same
 * conversation gets one banner from an open tab and another from a push.
 */
export function notificationGroupTag(
  target: Pick<NotificationTarget, "id" | "kind" | "referenceId">,
): string {
  if (target.kind !== NotificationKind.CHAT || !target.referenceId) {
    return target.id;
  }

  return `${CHAT_GROUP_TAG_PREFIX}${target.referenceId}`;
}

const showsNotificationsQuerySchema = z.object({
  type: z.literal(SHOWS_NOTIFICATIONS_QUERY),
});

const clickMessageSchema = z.object({
  type: z.literal(NOTIFICATION_CLICK_MESSAGE),
  target: notificationTargetSchema,
});

/** Tells a click whose target will not parse from a message that is not one. */
const clickMessageTypeSchema = z.object({
  type: z.literal(NOTIFICATION_CLICK_MESSAGE),
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
      getNotificationServiceWorkerUrl(),
    );
    // A registration that is installing cannot show anything yet. Awaited
    // rather than returned: a returned promise settles after the `try` is
    // over, so a rejected `ready` would skip the catch below and be cached as
    // a rejection for the life of the tab, which is what the caller documents
    // it does not do. MDN gives no rejection for `ready`, so this is a guard
    // on that contract rather than a fix for a failure seen in a browser.
    return registration.active
      ? registration
      : await navigator.serviceWorker.ready;
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
 * Take down every banner in one group.
 *
 * Called when the reader has read what the group was about, so the banners
 * stop describing a state that no longer exists. The tag is the filter, so a
 * room the reader has not read keeps its banner.
 *
 * Reads the registration rather than making one: a reader who never turned
 * notifications on has no banners to close, and closing them must not be what
 * installs a worker for them.
 *
 * Never throws. A browser that will not list its banners leaves them standing,
 * which is where they already were.
 */
export async function closeNotificationGroup(tag: string): Promise<void> {
  const registration = await getExistingNotificationServiceWorker();
  if (!registration) {
    return;
  }

  try {
    for (const banner of await registration.getNotifications({ tag })) {
      banner.close();
    }
  } catch (error) {
    console.error("Failed to close the notification group", error);
  }
}

/**
 * Shows an OS banner through the worker. Callers must gate with
 * `shouldShowBrowserNotification` first.
 *
 * `tag` is the banner's group, so a push for the same conversation replaces
 * this one in place instead of stacking beside it. Replacing is why the line
 * carries the room's count: the banner this one takes the place of is the
 * only record those messages arrived. Returns false when nothing was shown.
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
      tag: notificationGroupTag(target),
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
 *
 * Replying at all carries its own meaning, so mount this beside
 * `subscribeNotificationClicks` and drop the two together. The worker routes a
 * banner click to any page that answers, `false` included, because a detached
 * channel stops in-app updates and not click handling.
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
      return;
    }

    // Every worker message reaches every listener, so the query the worker
    // sends before it skips a banner lands here too. Only a message that says
    // it is a click is worth reporting: the worker validates the id alone, so
    // a payload Core changed (a dropped `referenceId`, a kind this build does
    // not know) arrives here and is dropped. The reader then clicks a banner,
    // watches a tab take the focus, and nothing more happens.
    if (clickMessageTypeSchema.safeParse(event.data).success) {
      console.error("Ignored a notification click target", message.error);
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
