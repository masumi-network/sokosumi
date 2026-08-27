/**
 * Sokosumi web push service worker (SOK-875).
 *
 * Ably subscribes this worker with `userVisibleOnly: true`, so every push
 * event MUST end in `showNotification`, apart from the focused-window
 * exception in `canSkipDisplay`. Skipping one anywhere else makes the browser
 * post its own "This site has been updated in the background" banner instead.
 *
 * Core sends no display strings (ADR-0020). This worker renders them from the
 * notification's `messageKey` and `messageParams`.
 *
 * Plain JavaScript on purpose: the browser fetches this file from `public/` as
 * written, so it never passes through the TypeScript build. Its copies of app
 * constants are guarded by tests instead of by the compiler.
 */

/**
 * Take over as soon as a new version installs, rather than waiting for every
 * tab to close. This worker carries the message catalog, so a version that
 * waits keeps rendering last release's strings for readers who never close
 * the app. No `clients.claim()` with it: nothing here needs to control a page.
 * Push events go to the active worker, and both message paths reach pages
 * through `clients.matchAll({ includeUncontrolled: true })`.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

const FALLBACK_LOCALE = "en";

/** Written by the app; mirrors LOCALE_COOKIE_NAME in @sokosumi/utils. */
const LOCALE_COOKIE_NAME = "sokosumi.locale";

/**
 * Copy of `Library.Notifications.Chat.*` from apps/web/messages/<locale>.json.
 *
 * A service worker cannot reach next-intl, so the tracer duplicates the two
 * chat strings. SOK-876 replaces this with the shared renderer. Change a
 * string here only together with the message files.
 */
const MESSAGES = {
  en: {
    "Notifications.Chat.mentioned": "{authorName} mentioned you in {roomName}",
    "Notifications.Chat.directMessage": "{authorName} sent you a message",
  },
  de: {
    "Notifications.Chat.mentioned":
      "{authorName} hat dich in {roomName} erwähnt",
    "Notifications.Chat.directMessage":
      "{authorName} hat dir eine Nachricht gesendet",
  },
  es: {
    "Notifications.Chat.mentioned": "{authorName} te mencionó en {roomName}",
    "Notifications.Chat.directMessage": "{authorName} te envió un mensaje",
  },
};

/**
 * Title of every banner, matching `Components.NotificationCenter.
 * browserNotificationTitle`, which reads "Sokosumi" in each locale. The
 * message goes in the body, so a push banner and a page banner for the same
 * notification look the same when one replaces the other by tag.
 */
const APP_TITLE = "Sokosumi";

/** Mirrors NOTIFICATION_ICON_PATH in the app. */
const ICON_PATH = "/images/app-icons/apple-icon-180.png";

/**
 * Tag for a payload that carries no id. Every such banner reads the same, so
 * one tag for all of them keeps a replay replacing rather than stacking.
 */
const GENERIC_TAG = "sokosumi-notification";

/**
 * The locale the reader chose in the app, when this browser exposes cookies to
 * workers. `cookieStore` is Chrome-only, and the app deletes the cookie when
 * the reader picks automatic detection rather than writing a value for it, so
 * both paths fall through to the browser language and then to English.
 */
async function resolveLocale() {
  try {
    if (self.cookieStore) {
      const cookie = await self.cookieStore.get(LOCALE_COOKIE_NAME);
      if (cookie && Object.hasOwn(MESSAGES, cookie.value)) {
        return cookie.value;
      }
    }
  } catch {
    // Cookie access can throw on a partitioned or restricted origin.
  }

  const browserLocale = (self.navigator.language || "").split("-")[0];
  return Object.hasOwn(MESSAGES, browserLocale)
    ? browserLocale
    : FALLBACK_LOCALE;
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/**
 * Ably's exact web push envelope is not yet observed live, so accept the
 * documented `{ data: … }` wrapper, the same wrapper with `data` delivered as a
 * JSON string, and a flat map. Never throw: a push that throws here shows the
 * generic banner instead of the notification the reader was sent.
 */
function readPushData(data) {
  try {
    const payload = data ? data.json() : null;
    if (payload && typeof payload === "object") {
      // Web Push carries text, and a transport that re-encodes the map hands
      // it over as a string rather than an object.
      if (typeof payload.data === "string") {
        return parseParams(payload.data);
      }

      return payload.data && typeof payload.data === "object"
        ? payload.data
        : payload;
    }
  } catch {
    // Not JSON. Fall through to the generic banner.
  }

  return {};
}

function parseParams(raw) {
  if (typeof raw !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * What a click needs to reach the notification's destination. Mirrors
 * `notificationTargetSchema` in the app, which validates it on arrival.
 */
function buildTarget(pushData) {
  if (typeof pushData.id !== "string" || !pushData.id) {
    return null;
  }

  return {
    id: pushData.id,
    kind: pushData.kind,
    referenceId: pushData.referenceId,
    messageKey: pushData.messageKey,
    // Core omits metadata when it is null, and the app's schema wants that
    // null back rather than an empty object.
    metadata:
      typeof pushData.metadata === "string"
        ? parseParams(pushData.metadata)
        : null,
  };
}

/** The rendered message, or undefined when the payload names no known key. */
async function buildBody(pushData) {
  const messages = MESSAGES[await resolveLocale()];
  // `hasOwn`, so a payload naming "constructor" cannot reach a prototype
  // member and throw. A push that throws shows no banner at all.
  if (!Object.hasOwn(messages, pushData.messageKey)) {
    return undefined;
  }

  return interpolate(
    messages[pushData.messageKey],
    parseParams(pushData.messageParams),
  );
}

/** Mirrors SHOWS_NOTIFICATIONS_QUERY in the app. */
const SHOWS_NOTIFICATIONS_QUERY = "sokosumi:shows-notifications";

/** How long a focused page has to claim it shows notifications itself. */
const SHOWS_NOTIFICATIONS_TIMEOUT_MS = 200;

/**
 * Whether this page shows notifications in the app itself. Only pages that
 * mount the notification listener answer at all, so a focused tab on a share
 * link or the sign-in page reads as false and keeps its banner. A page that
 * answers can still say no: it mounts the listener but has stopped receiving.
 */
function showsNotificationsInApp(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();

    const answer = (showsInApp) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(showsInApp);
    };

    const timer = setTimeout(
      () => answer(false),
      SHOWS_NOTIFICATIONS_TIMEOUT_MS,
    );

    channel.port1.onmessage = (event) => answer(event.data === true);

    client.postMessage({ type: SHOWS_NOTIFICATIONS_QUERY }, [channel.port2]);
  });
}

/**
 * Whether this push may render nothing.
 *
 * Chromium documents a focused-window exception: a handler does not have to
 * show a notification while the reader already has the site open and focused
 * (ADR-0020). WebKit grants no exception and revokes the subscription when a
 * push displays nothing, so every other engine always displays.
 *
 * "Open and focused" means a page that shows the notification itself, so this
 * asks the focused pages rather than assuming any same-origin tab counts.
 *
 * `userAgentData` is missing outside Chromium (MDN: "not Baseline … does not
 * work in some of the most widely-used browsers"), so its absence is read as
 * "no exception". That is the safe direction: a surplus banner costs less than
 * a revoked subscription.
 */
async function canSkipDisplay() {
  if (!self.navigator.userAgentData) {
    return false;
  }

  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const focused = windows.filter(
    (client) => client.focused && client.visibilityState === "visible",
  );

  if (focused.length === 0) {
    return false;
  }

  const answers = await Promise.all(focused.map(showsNotificationsInApp));
  return answers.some(Boolean);
}

async function showPushNotification(data) {
  if (await canSkipDisplay()) {
    return;
  }

  const pushData = readPushData(data);

  const target = buildTarget(pushData);

  await self.registration.showNotification(APP_TITLE, {
    body: await buildBody(pushData),
    tag: target ? target.id : GENERIC_TAG,
    icon: ICON_PATH,
    data: target,
  });
}

/** Last resort, so a thrown handler still leaves the reader something. */
function showFallbackNotification() {
  return self.registration.showNotification(APP_TITLE, {
    tag: GENERIC_TAG,
    icon: ICON_PATH,
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    showPushNotification(event.data).catch(() =>
      showFallbackNotification().catch(() => {
        // Nothing left to try. The browser posts its own banner instead.
      }),
    ),
  );
});

/** Mirrors NOTIFICATION_CLICK_MESSAGE in the app. */
const CLICK_MESSAGE_TYPE = "sokosumi:notification-click";

/**
 * The first open tab that shows notifications in the app, so a click reaches a
 * page that can act on it. A tab showing a share link or the sign-in page
 * cannot, and focusing one of those would drop the click in silence.
 */
async function findRoutingClient(windows) {
  const candidates = windows.filter((client) => "focus" in client);
  const answers = await Promise.all(candidates.map(showsNotificationsInApp));

  return candidates.find((_client, index) => answers[index]) || null;
}

/**
 * Focus a tab that can act on the click and hand it the banner's target, so
 * the page can mark the notification read and route to it. The target rides on
 * the banner rather than in the page, because the tab that receives this click
 * is not always the tab that rendered the banner. With no such tab, open the
 * app; SOK-876 owns routing from there to the room the notification came from.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const open = await findRoutingClient(windows);
      if (open) {
        await open.focus();
        if (target) {
          open.postMessage({ type: CLICK_MESSAGE_TYPE, target });
        }
        return;
      }

      await self.clients.openWindow("/");
    })(),
  );
});
