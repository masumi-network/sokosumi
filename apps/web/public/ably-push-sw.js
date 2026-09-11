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
 * That constraint is also why two decisions exist twice. `buildTarget` here
 * builds the same shape as `toNotificationTarget` in
 * `lib/utils/notification-service-worker.ts`. `canSkipDisplay` here decides
 * the focused-page suppression that `shouldShowBrowserNotification` in
 * `lib/utils/browser-notification.ts` decides for the page, from different
 * inputs and in the opposite direction: the worker sees neither `isRead` nor
 * the permission, and reads focus from `clients.matchAll` rather than from the
 * document. The spec wants one pure function both paths call; SOK-876 owns
 * that renderer, and it takes these two pairs and the imported catalog with
 * it.
 */

/**
 * Take over as soon as a new version installs, rather than waiting for every
 * tab to close. This worker renders the message catalog, so a version that
 * waits keeps rendering last release's strings for readers who never close
 * the app. No `clients.claim()` with it: nothing here needs to control a page.
 * Push events go to the active worker, and both message paths reach pages
 * through `clients.matchAll({ includeUncontrolled: true })`.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

/**
 * The notification strings, in the worker's own global scope.
 *
 * Synchronous by definition, and read only from inside the handlers below, so
 * a push cannot arrive before the catalog is there. Absolute, because the
 * worker is served from the origin root with a query string on it and a
 * relative path would have to be resolved against that.
 */
importScripts("/ably-push-messages.js");

const FALLBACK_LOCALE = "en";

/** Written by the app; mirrors LOCALE_COOKIE_NAME in @sokosumi/utils. */
const LOCALE_COOKIE_NAME = "sokosumi.locale";

/**
 * Matches Components.NotificationCenter.browserNotificationTitle. Grouped
 * chat arrivals and other kinds use the app name. Single chat arrivals name
 * who wrote and where. The app and worker follow the same rule, but can
 * resolve different locales (see resolveLocale).
 */
const APP_TITLE = "Sokosumi";

/** Mirrors NOTIFICATION_ICON_PATH in the app. */
const ICON_PATH = "/images/app-icons/apple-icon-180.png";

/**
 * Tag for a payload that carries no id. Every such banner reads the same, so
 * one tag for all of them keeps a replay replacing rather than stacking.
 */
const GENERIC_TAG = "sokosumi-notification";

/** Mirrors CHAT_GROUP_TAG_PREFIX in the app. */
const CHAT_GROUP_TAG_PREFIX = "sokosumi-room:";

/** Mirrors notificationGroupTag: chat replaces by room, other kinds by row. */
function groupTag(target) {
  if (target.kind !== "CHAT" || !target.referenceId) {
    return target.id;
  }

  return `${CHAT_GROUP_TAG_PREFIX}${target.referenceId}`;
}

/** Mirrors the chat message keys in @sokosumi/utils. */
const CHAT_MENTION_KEY = "Notifications.Chat.mentioned";
const CHAT_MENTION_DIRECT_KEY = "Notifications.Chat.mentionedDirect";
const CHAT_DIRECT_MESSAGE_KEY = "Notifications.Chat.directMessage";
const CHAT_DIRECT_MESSAGES_KEY = "Notifications.Chat.directMessages";
const CHAT_ROOM_MESSAGE_KEY = "Notifications.Chat.roomMessage";
const CHAT_ROOM_MESSAGES_KEY = "Notifications.Chat.roomMessages";
const CHAT_ROOM_MESSAGE_GROUP_KEY = "Notifications.Chat.roomMessageGroup";
const CHAT_ROOM_MESSAGES_GROUP_KEY = "Notifications.Chat.roomMessagesGroup";

/** Mirrors countedMessageKey in lib/utils/notification-message. */
function countedMessageKey(messageKey, params, count) {
  const group = params.isGroup === true;
  const pair = messageKey === CHAT_MENTION_KEY && params.isDirect === true;

  if (!(Number.isInteger(count) && count > 1)) {
    if (pair) {
      return CHAT_MENTION_DIRECT_KEY;
    }

    return messageKey === CHAT_ROOM_MESSAGE_KEY && group
      ? CHAT_ROOM_MESSAGE_GROUP_KEY
      : messageKey;
  }

  if (messageKey === CHAT_DIRECT_MESSAGE_KEY || pair) {
    return CHAT_DIRECT_MESSAGES_KEY;
  }

  if (messageKey === CHAT_MENTION_KEY || messageKey === CHAT_ROOM_MESSAGE_KEY) {
    return group ? CHAT_ROOM_MESSAGES_GROUP_KEY : CHAT_ROOM_MESSAGES_KEY;
  }

  return messageKey;
}

/** Parse Core's room count from the push string map, if available. */
function groupCountOn(raw) {
  if (typeof raw !== "string" || raw === "") {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

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
    ...(typeof pushData.createdAt === "string"
      ? { createdAt: pushData.createdAt }
      : {}),
    // Core omits metadata when it is null, and the app's schema wants that
    // null back rather than an empty object.
    metadata:
      typeof pushData.metadata === "string"
        ? parseParams(pushData.metadata)
        : null,
  };
}

const CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageTitle";
const CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroupTitle";

/** The rendered string for a key, or undefined when the catalog lacks it. */
function render(messages, messageKey, params) {
  // `hasOwn`, so a payload naming "constructor" cannot reach a prototype
  // member and throw. A push that throws shows no banner at all.
  if (!Object.hasOwn(messages, messageKey)) {
    return undefined;
  }

  return interpolate(messages[messageKey], params);
}

/**
 * The banner title for a chat message, or undefined when the key is not one.
 *
 * Mirrors `chatTitle` in `lib/utils/notification-banner.ts`, which titles the
 * banner an open tab renders. Every chat title names the author, so a message
 * with no author to name has no title to give.
 */
function chatTitle(messages, messageKey, params) {
  if (typeof params.authorName !== "string" || !params.authorName) {
    return undefined;
  }

  if (
    messageKey === CHAT_DIRECT_MESSAGE_KEY ||
    (messageKey === CHAT_MENTION_KEY && params.isDirect === true)
  ) {
    return params.authorName;
  }

  if (
    (messageKey === CHAT_MENTION_KEY || messageKey === CHAT_ROOM_MESSAGE_KEY) &&
    (typeof params.roomName !== "string" || !params.roomName.trim())
  ) {
    return params.authorName;
  }

  if (messageKey === CHAT_MENTION_KEY) {
    return render(messages, messageKey, params);
  }

  if (messageKey === CHAT_ROOM_MESSAGE_KEY) {
    return render(
      messages,
      params.isGroup === true
        ? CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY
        : CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY,
      params,
    );
  }

  return undefined;
}

/**
 * The title and body this push puts on the banner.
 *
 * Mirrors `buildNotificationBannerContent` in the app: a chat message is
 * titled with who wrote and where, and the message itself goes underneath.
 * Multiple chat arrivals show the room count under the app title. Other
 * kinds keep the app name and their line. Single chat arrivals without
 * preview text keep their chat title and have no body.
 */
async function buildBanner(pushData) {
  const messages = MESSAGES[await resolveLocale()];
  const params = parseParams(pushData.messageParams);
  const preview = params.messagePreview;
  const count = groupCountOn(pushData.groupCount) ?? params.count;
  const messageKey = countedMessageKey(pushData.messageKey, params, count);

  if (
    Number.isInteger(count) &&
    count > 1 &&
    messageKey !== pushData.messageKey
  ) {
    return {
      title: APP_TITLE,
      body: render(messages, messageKey, { ...params, count }),
    };
  }

  const title = chatTitle(messages, pushData.messageKey, params);
  if (title !== undefined) {
    return { title, body: typeof preview === "string" ? preview : "" };
  }

  return {
    title: APP_TITLE,
    body: render(messages, messageKey, { ...params, count }),
  };
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
  if (!target) {
    // Core sends an `id` on every push, so no target means the envelope did
    // not arrive in a shape this worker reads. The banner below then carries
    // the app name and nothing else, which on its own looks like a push that
    // genuinely said nothing. Keys only: the values are the reader's own
    // mention text.
    console.error("Could not read the push payload", Object.keys(pushData));
  }

  const banner = await buildBanner(pushData);

  await self.registration.showNotification(banner.title, {
    body: banner.body,
    tag: target ? groupTag(target) : GENERIC_TAG,
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
    showPushNotification(event.data).catch((error) => {
      // The fallback carries no body and no target, so the reader gets a bare
      // title they cannot click through to anything. The two ways to land
      // here, a rejected `showNotification` and a rejected `clients.matchAll`
      // inside the skip check, leave no other trace.
      console.error("Could not render a push notification", error);
      return showFallbackNotification().catch(() => {
        // Nothing left to try. The browser posts its own banner instead.
      });
    }),
  );
});

/** Mirrors NOTIFICATION_CLICK_MESSAGE in the app. */
const CLICK_MESSAGE_TYPE = "sokosumi:notification-click";

function readConfiguredAppOrigin() {
  try {
    const configuredUrl = new URL(self.location.href).searchParams.get(
      "appUrl",
    );
    if (!configuredUrl) {
      return null;
    }

    const url = new URL(configuredUrl);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

const CONFIGURED_APP_ORIGIN = readConfiguredAppOrigin();

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

/** Mirrors NOTIFICATION_TARGET_PARAM in the app. */
const TARGET_PARAM = "notification";

/**
 * Where a click lands when no tab could take it.
 *
 * The target rides on the URL rather than being posted, because the window
 * does not exist yet when this handler ends and the worker may be stopped
 * before it loads. The page that comes up spends the parameter and runs the
 * same routing a focused tab runs, so the reader lands on the message the
 * banner named rather than on the app's front page.
 *
 * A destination is deliberately not built here. A notification from another
 * workspace has to switch the active organization before its room will open,
 * and the room page redirects home without that switch, so an href alone
 * would trade a wrong landing for a different one.
 */
function appWindowUrl(target) {
  const base = CONFIGURED_APP_ORIGIN || "/";
  if (!target) {
    return base;
  }

  const separator = base.endsWith("/") ? "" : "/";
  return `${base}${separator}?${TARGET_PARAM}=${encodeURIComponent(
    JSON.stringify(target),
  )}`;
}

/**
 * Open the app for a click no tab could take.
 *
 * This rejects with `InvalidAccessError` under the same condition `focus()`
 * does, a window in the origin holding transient activation (MDN,
 * `Clients.openWindow`), and the condition is per origin rather than per tab.
 * So a click that no tab would take usually cannot open a window either, and
 * there is nothing further to try. The click handler below says why it does
 * not fall back to a tab that stayed hidden. Reported rather than thrown: the
 * banner is already closed, `waitUntil` has nothing to catch a rejection here,
 * and a click that reached nothing at all should not also be silent.
 */
async function openAppWindow(target) {
  try {
    await self.clients.openWindow(appWindowUrl(target));
  } catch (error) {
    console.error("Could not open a window for a notification click", error);
  }
}

/**
 * Focus a tab that can act on the click and hand it the banner's target, so
 * the page can mark the notification read and route to it. The target rides on
 * the banner rather than in the page, because the tab that receives this click
 * is not always the tab that rendered the banner. With no tab at all, open a
 * window carrying the target, which the page it loads routes for itself.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data;

  event.waitUntil(
    (async () => {
      if (
        CONFIGURED_APP_ORIGIN &&
        CONFIGURED_APP_ORIGIN !== self.location.origin
      ) {
        await openAppWindow(target);
        return;
      }

      // A failed look at the open tabs reads as no tabs, not as a failed
      // click. Left to reject it would carry off the whole handler, and the
      // banner is closed by here: the reader would get no window and no word
      // of why. The push handler guards this same call.
      //
      // Warned, not reported: a window still opens, so the click is not lost.
      // What the reader loses is the tab they had and the room the banner
      // came from, which is worth a line when someone asks why a click opened
      // a second tab on the home page.
      const windows = await self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .catch((error) => {
          console.warn("Could not read the open tabs for a click", error);
          return [];
        });

      const open = await findRoutingClient(windows);
      // Only a tab that came forward is handed the target. A click on a
      // notification from another workspace switches the active organization,
      // which is a session-wide write every tab shares, so a tab that stayed
      // hidden would move the reader's front tab into that workspace on its
      // own. The worker cannot tell that click from a same-workspace one,
      // which only navigates the tab that takes it, so it withholds from both.
      if (open && (await focusRoutingClient(open))) {
        if (target) {
          open.postMessage({ type: CLICK_MESSAGE_TYPE, target });
        }
        return;
      }

      // Withheld from the window as well when a tab was there and would not
      // come forward. Routing the target switches the active organization,
      // and that write is the session's rather than the window's, so it
      // reaches the tab that stayed put whichever page performs it. The
      // reason above does not care which page was handed the target.
      await openAppWindow(open ? null : target);
    })(),
  );
});
