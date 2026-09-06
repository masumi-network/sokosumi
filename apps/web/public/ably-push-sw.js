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
 * that renderer, and it takes these two pairs and the catalog below with it.
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
 * Copy of every notification string from apps/web/messages/<locale>.json.
 *
 * A service worker cannot reach next-intl, so this worker duplicates them.
 * Two shapes, because Core stores two: Job, Task and Chat come from
 * `Library.Notifications.<Group>` and are keyed `Notifications.<Group>.<key>`;
 * the system keys sit at the catalog root and Core stores them verbatim.
 *
 * Generated from the catalogs rather than typed by hand, and guarded by
 * `push-service-worker-messages.test.ts`, which fails when a catalog string
 * changes without this copy changing with it. SOK-876 replaces the whole copy
 * with the shared renderer.
 */
const MESSAGES = {
  en: {
    "Notifications.Job.completed": "{agentName} completed {jobName}",
    "Notifications.Job.failed": "{agentName} failed to complete {jobName}",
    "Notifications.Job.paymentFailed": "Payment failed for {jobName}",
    "Notifications.Job.inputRequired":
      "{agentName} needs your input for {jobName}",
    "Notifications.Job.refundResolved": "{jobName} was refunded",
    "Notifications.Job.disputeResolved": "Dispute resolved for {jobName}",
    "Notifications.Task.inputRequired":
      "{coworkerName} needs your input for {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} needs your approval for {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} needs authentication for {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} ran out of credits for {taskName}",
    "Notifications.Task.completed": "{coworkerName} completed {taskName}",
    "Notifications.Task.failed": "{coworkerName} failed to complete {taskName}",
    "Notifications.Task.canceled": "{taskName} was canceled",
    "Notifications.Task.scheduleRepaired":
      "The schedule for {taskName} was repaired",
    "Notifications.Task.scheduleRemovedByOperator":
      "The schedule for {taskName} was removed after review",
    "Notifications.Chat.mentioned": "{authorName} mentioned you in {roomName}",
    "Notifications.Chat.directMessage": "{authorName} sent you a message",
    "Notifications.Chat.roomMessage": "{authorName} wrote in {roomName}",
    "notifications.vendorGrant.pending":
      "{vendorName} requested vendor access to your workspace",
    "notifications.coworkerAccess.pending":
      "{coworkerName} requested coworker early access to your workspace",
  },
  de: {
    "Notifications.Job.completed": "{agentName} hat {jobName} abgeschlossen",
    "Notifications.Job.failed":
      "{agentName} konnte {jobName} nicht abschließen",
    "Notifications.Job.paymentFailed": "Zahlung für {jobName} fehlgeschlagen",
    "Notifications.Job.inputRequired":
      "{agentName} benötigt deinen Input für {jobName}",
    "Notifications.Job.refundResolved": "{jobName} wurde erstattet",
    "Notifications.Job.disputeResolved": "Einspruch für {jobName} gelöst",
    "Notifications.Task.inputRequired":
      "{coworkerName} benötigt deinen Input für {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} benötigt deine Freigabe für {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} benötigt eine Authentifizierung für {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} hat keine Credits mehr für {taskName}",
    "Notifications.Task.completed":
      "{coworkerName} hat {taskName} abgeschlossen",
    "Notifications.Task.failed":
      "{coworkerName} konnte {taskName} nicht abschließen",
    "Notifications.Task.canceled": "{taskName} wurde abgebrochen",
    "Notifications.Task.scheduleRepaired":
      "Der Zeitplan für {taskName} wurde repariert",
    "Notifications.Task.scheduleRemovedByOperator":
      "Der Zeitplan für {taskName} wurde nach der Prüfung entfernt",
    "Notifications.Chat.mentioned":
      "{authorName} hat dich in {roomName} erwähnt",
    "Notifications.Chat.directMessage":
      "{authorName} hat dir eine Nachricht gesendet",
    "Notifications.Chat.roomMessage":
      "{authorName} hat in {roomName} geschrieben",
    "notifications.vendorGrant.pending":
      "{vendorName} hat Vendor-Zugriff auf den Organisations-Workspace angefordert",
    "notifications.coworkerAccess.pending":
      "{coworkerName} hat Coworker-Early-Access für deinen Workspace angefordert",
  },
  es: {
    "Notifications.Job.completed": "{agentName} completó {jobName}",
    "Notifications.Job.failed": "{agentName} no pudo completar {jobName}",
    "Notifications.Job.paymentFailed": "Error de pago para {jobName}",
    "Notifications.Job.inputRequired":
      "{agentName} necesita tu input para {jobName}",
    "Notifications.Job.refundResolved": "{jobName} fue reembolsado",
    "Notifications.Job.disputeResolved": "Disputa resuelta para {jobName}",
    "Notifications.Task.inputRequired":
      "{coworkerName} necesita tu input para {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} necesita tu aprobación para {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} necesita autenticación para {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} se quedó sin créditos para {taskName}",
    "Notifications.Task.completed": "{coworkerName} completó {taskName}",
    "Notifications.Task.failed": "{coworkerName} no pudo completar {taskName}",
    "Notifications.Task.canceled": "{taskName} fue cancelado",
    "Notifications.Task.scheduleRepaired":
      "Se reparó la programación de {taskName}",
    "Notifications.Task.scheduleRemovedByOperator":
      "Se eliminó la programación de {taskName} después de revisarla",
    "Notifications.Chat.mentioned": "{authorName} te mencionó en {roomName}",
    "Notifications.Chat.directMessage": "{authorName} te envió un mensaje",
    "Notifications.Chat.roomMessage": "{authorName} escribió en {roomName}",
    "notifications.vendorGrant.pending":
      "{vendorName} solicitó acceso de proveedor al workspace de la organización",
    "notifications.coworkerAccess.pending":
      "{coworkerName} solicitó acceso anticipado de coworker a tu espacio de trabajo",
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
  if (!target) {
    // Core sends an `id` on every push, so no target means the envelope did
    // not arrive in a shape this worker reads. The banner below then carries
    // the app name and nothing else, which on its own looks like a push that
    // genuinely said nothing. Keys only: the values are the reader's own
    // mention text.
    console.error("Could not read the push payload", Object.keys(pushData));
  }

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
 * there is nothing further to try. The click handler below says why it does
 * not fall back to a tab that stayed hidden. Reported rather than thrown: the
 * banner is already closed, `waitUntil` has nothing to catch a rejection here,
 * and a click that reached nothing at all should not also be silent.
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

      await openAppWindow();
    })(),
  );
});
