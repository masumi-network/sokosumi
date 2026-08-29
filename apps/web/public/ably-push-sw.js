/**
 * Sokosumi web push service worker (SOK-875).
 *
 * Ably subscribes this worker with `userVisibleOnly: true`, so every push
 * event MUST end in `showNotification`, apart from the focused-window
 * exception in `canSkipDisplay`. Skipping one anywhere else makes the browser
 * post its own "This site has been updated in the background" banner instead.
 *
 * Core sends no display strings (ADR-0023). This worker renders them from the
 * notification's `messageKey` and `messageParams`.
 *
 * Plain JavaScript on purpose: the browser fetches this file from `public/` as
 * written, so it never passes through the TypeScript build. Its copies of app
 * constants are guarded by tests instead of by the compiler.
 *
 * That constraint is also why two decisions exist twice. `canSkipDisplay` here
 * answers the same question as `shouldShowBrowserNotification` in
 * `lib/utils/browser-notification.ts`, and `buildTarget` here builds the same
 * shape as `toNotificationTarget` in `lib/utils/notification-service-worker.ts`.
 * The spec wants one pure function both paths call; SOK-876 owns that renderer,
 * and it takes these two pairs and the catalog below with it.
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
 * A service worker cannot reach next-intl, so this worker duplicates the two
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

  return resolveBrowserLocale();
}

/**
 * The first browser language this worker has strings for.
 *
 * Reads the whole list, not just `navigator.language`. The app negotiates
 * every entry of `Accept-Language` in order (`resolveLocaleFromAcceptLanguage`
 * in `@sokosumi/utils`), and `navigator.languages` is the same list in the
 * same order. Reading only the first entry made a reader who prefers an
 * unsupported language over a supported one read the app in their second
 * choice and the banners in English.
 */
function resolveBrowserLocale() {
  const preferences = self.navigator.languages?.length
    ? self.navigator.languages
    : [self.navigator.language];

  for (const preference of preferences) {
    const locale = (preference || "").split("-")[0];
    if (Object.hasOwn(MESSAGES, locale)) {
      return locale;
    }
  }

  return FALLBACK_LOCALE;
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

/** Nothing replied inside the timeout: this page has no listener mounted. */
const NO_ANSWER = "no-answer";

/**
 * Ask one page whether it shows notifications in the app itself.
 *
 * Three outcomes, not two, because the two callers ask for different reasons.
 * `true` and `false` both come from a page that mounts the notification
 * listener; `NO_ANSWER` means nothing there answers at all, so the page is a
 * share link or the sign-in page.
 *
 * That distinction is the whole point. A page that answers has the listener
 * mounted, and that listener handles banner clicks whatever it says here: it
 * subscribes to clicks and answers this query from one mount. `false` only
 * means the channel has stopped receiving, which costs the page its in-app
 * update and nothing else.
 */
function askShowsNotifications(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();

    const answer = (showsInApp) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(showsInApp);
    };

    const timer = setTimeout(
      () => answer(NO_ANSWER),
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
 * (ADR-0023). WebKit grants no exception and revokes the subscription when a
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

  // Only a page that says yes renders this notification itself. A page that
  // says no, and a page with no listener at all, both need the banner.
  const answers = await Promise.all(focused.map(askShowsNotifications));
  return answers.some((answer) => answer === true);
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
 * The first open tab that can act on a click. A tab showing a share link or
 * the sign-in page cannot, and focusing one of those would drop the click in
 * silence.
 *
 * Any reply qualifies, including `false`. Requiring `true` here would reject a
 * tab whose channel is merely detached, which is the ordinary state of a tab
 * that has sat in the background: the click would then open a second tab on
 * the home page and leave the notification unread, with the tab that could
 * have handled it still sitting there.
 */
async function findRoutingClient(windows) {
  const candidates = windows.filter((client) => "focus" in client);
  const answers = await Promise.all(candidates.map(askShowsNotifications));

  return (
    candidates.find((_client, index) => answers[index] !== NO_ANSWER) || null
  );
}

/**
 * Whether the tab took the focus.
 *
 * `focus()` rejects with `InvalidAccessError` unless a window in the origin
 * holds transient activation (MDN, `WindowClient.focus`). The banner is closed
 * by the time this runs, so a rejection left to propagate would take the click
 * with it: the banner would vanish and nothing would happen at all.
 */
async function focusRoutingClient(client) {
  try {
    await client.focus();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the app for a click no tab could take.
 *
 * This rejects with `InvalidAccessError` under the same condition `focus()`
 * does, a window in the origin holding transient activation (MDN,
 * `Clients.openWindow`), and the condition is per origin rather than per tab.
 * So a click that no tab would take usually cannot open a window either, and
 * there is nothing further to try: handing the target to a tab that stayed
 * hidden would switch the reader's workspace behind their back, which is
 * worse than the click going nowhere. Reported rather than thrown: the banner
 * is already closed, `waitUntil` has nothing to catch a rejection here, and a
 * click that reached nothing at all should not also be silent.
 */
async function openAppWindow() {
  try {
    await self.clients.openWindow("/");
  } catch (error) {
    console.error("Could not open a window for a notification click", error);
  }
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
      // Only a tab that came forward is handed the target. Acting on a click
      // sets the active organization for the whole session and navigates the
      // tab that took it, so a tab that stayed hidden would move the reader's
      // front tab into another workspace on its own.
      if (open && (await focusRoutingClient(open))) {
        if (target) {
          open.postMessage({ type: CLICK_MESSAGE_TYPE, target });
        }
        return;
      }

      await openAppWindow();
    })(),
  );
});
