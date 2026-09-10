import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { buildNotificationBannerContent } from "@/lib/utils/notification-banner";
import { getNotificationMessageTranslationKey } from "@/lib/utils/notification-message";
import {
  NOTIFICATION_SERVICE_WORKER_URL,
  NOTIFICATION_TARGET_PARAM,
  notificationGroupTag,
  notificationTargetSchema,
} from "@/lib/utils/notification-service-worker";
import enMessages from "@/messages/en.json";

/**
 * The worker ships as a plain script in `public/`, so it cannot be imported.
 * These tests run its source in a sandbox that stands in for the service
 * worker global, and drive it through a real `push` event.
 */
// Built from the URL production registers, not from the literal. Renaming the
// constant alone would 404 the worker and take every banner with it, and a
// hardcoded path here would keep passing over that.
const SERVICE_WORKER_PATH = join(
  process.cwd(),
  "public",
  NOTIFICATION_SERVICE_WORKER_URL,
);

interface WindowClientStub {
  focused: boolean;
  visibilityState: "visible" | "hidden";
  focus?: () => Promise<void>;
  postMessage?: (message: unknown, transfer?: unknown[]) => void;
}

/** A page that mounts the notification listener answers the worker's query. */
function appPage({
  postMessage,
  ...overrides
}: Partial<WindowClientStub> = {}): WindowClientStub {
  return {
    focused: true,
    visibilityState: "visible",
    ...overrides,
    postMessage: (message: unknown, transfer?: unknown[]) => {
      const port = transfer?.[0] as MessagePort | undefined;
      if (port) {
        port.postMessage(true);
        return;
      }

      postMessage?.(message);
    },
  };
}

/** A page with the listener mounted that has stopped receiving events. */
function stalledPage({
  postMessage,
  ...overrides
}: Partial<WindowClientStub> = {}): WindowClientStub {
  return {
    focused: true,
    visibilityState: "visible",
    ...overrides,
    postMessage: (message: unknown, transfer?: unknown[]) => {
      const port = transfer?.[0] as MessagePort | undefined;
      if (port) {
        port.postMessage(false);
        return;
      }

      postMessage?.(message);
    },
  };
}

/** A page without the listener: a share link, the sign-in page. */
function silentPage(
  overrides: Partial<WindowClientStub> = {},
): WindowClientStub {
  return {
    focused: true,
    visibilityState: "visible",
    postMessage: () => {},
    ...overrides,
  };
}

interface ShownNotification {
  title: string;
  options: {
    body?: string;
    tag?: string;
    icon?: string;
    data?: Record<string, unknown> | null;
  };
}

function loadServiceWorker({
  isChromium,
  windows = [],
  matchAllThrows = false,
  openWindowThrows = false,
  appUrl,
  locale,
  browserLanguages,
}: {
  isChromium: boolean;
  windows?: WindowClientStub[];
  matchAllThrows?: boolean;
  openWindowThrows?: boolean;
  appUrl?: string;
  locale?: string;
  browserLanguages?: string[];
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: ShownNotification[] = [];
  const openedWindows: string[] = [];
  const skipWaiting = vi.fn();
  // The sandbox gets its own `console`, so a spy on this realm's would never
  // see the worker's. Hand it one the test can read instead. Both methods the
  // worker uses are stubbed: a missing one throws in the sandbox, where the
  // browser would have carried on.
  const reported = vi.fn();
  const warned = vi.fn();
  const workerUrl = new URL(
    NOTIFICATION_SERVICE_WORKER_URL,
    "https://deployment-hash.preview.sokosumi.com",
  );
  if (appUrl) {
    workerUrl.searchParams.set("appUrl", appUrl);
  }

  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting,
    location: {
      href: workerUrl.href,
      origin: workerUrl.origin,
    },
    ...(locale
      ? { cookieStore: { get: async () => ({ value: locale }) } }
      : {}),
    navigator: {
      language: browserLanguages?.[0] ?? "en-US",
      ...(browserLanguages ? { languages: browserLanguages } : {}),
      ...(isChromium ? { userAgentData: { brands: [] } } : {}),
    },
    clients: {
      matchAll: async () => {
        if (matchAllThrows) {
          throw new Error("clients unavailable");
        }
        return windows;
      },
      openWindow: async (url: string) => {
        // `openWindow` and `focus` share one precondition, so a browser that
        // refuses the focus refuses this too. A harness that always resolves
        // hides that, and hid it once already.
        if (openWindowThrows) {
          throw new Error("InvalidAccessError");
        }
        openedWindows.push(url);
      },
    },
    registration: {
      showNotification: async (
        title: string,
        options: { tag?: string },
      ): Promise<void> => {
        shown.push({ title, options });
      },
    },
  };

  runInContext(
    readFileSync(SERVICE_WORKER_PATH, "utf8"),
    createContext({
      self,
      setTimeout,
      clearTimeout,
      console: { error: reported, warn: warned },
      // The sandbox has no DOM. A synchronous pair is enough: the worker
      // assigns `port1.onmessage` before it hands `port2` to the client.
      MessageChannel: class {
        port1: {
          onmessage: ((event: { data: unknown }) => void) | null;
          close: () => void;
        } = {
          onmessage: null,
          close: () => {
            this.port1.onmessage = null;
          },
        };
        port2 = {
          postMessage: (data: unknown) => {
            this.port1.onmessage?.({ data });
          },
        };
      },
      URL,
    }),
  );

  async function dispatchPush(data: unknown) {
    const pending: Promise<unknown>[] = [];
    listeners.get("push")?.({
      data: { json: () => data },
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    });
    await Promise.all(pending);
  }

  async function dispatchNotificationClick(data: unknown) {
    const pending: Promise<unknown>[] = [];
    const close = vi.fn();
    listeners.get("notificationclick")?.({
      notification: { close, data },
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    });
    await Promise.all(pending);
    return { close };
  }

  function dispatchInstall() {
    listeners.get("install")?.({});
  }

  return {
    dispatchPush,
    dispatchNotificationClick,
    dispatchInstall,
    skipWaiting,
    shown,
    openedWindows,
    reported,
    warned,
  };
}

const MENTION_PUSH = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  messageParams: JSON.stringify({
    authorName: "Ada",
    roomName: "General",
    messagePreview: "your call",
  }),
};

const MENTION_TARGET = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  metadata: null,
};

describe("ably-push-sw display", () => {
  /** `sokosumi.locale` is client-writable, so its value is not trusted. */
  it("ignores a cookie naming a prototype member", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      locale: "constructor",
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown[0]?.title).toBe("Ada mentioned you in General");
  });

  /**
   * The cookie is the locale the reader picked in the app, so it outranks the
   * browser's own list. Read with a Spanish browser, so the assertion fails
   * both ways: a cookie the worker never reads leaves the banner in Spanish.
   */
  it("prefers the locale the reader picked over the browser's", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      locale: "de",
      browserLanguages: ["es-ES"],
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown[0]?.title).toBe("Ada hat dich in General erwähnt");
  });

  /**
   * The app negotiates every `Accept-Language` entry in order, and
   * `navigator.languages` is that same list. Reading only the first entry gave
   * a reader who prefers an unsupported language the app in German and the
   * banners in English.
   */
  it("reads past a browser language it has no strings for", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      browserLanguages: ["fr-FR", "de"],
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown[0]?.title).toBe("Ada hat dich in General erwähnt");
  });

  it("renders the localized message tagged with the room it came from", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toEqual([
      {
        title: "Ada mentioned you in General",
        options: {
          body: "your call",
          tag: "sokosumi-room:room-1",
          icon: "/images/app-icons/apple-icon-180.png",
          data: MENTION_TARGET,
        },
      },
    ]);
  });

  /**
   * The title carries who wrote and where, so the body is free for the words
   * themselves. The operating system prints the app name beside the banner
   * already, and a reader cannot judge a message from the app name.
   */
  it("titles a room message with who wrote and where", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        messagePreview: "can you look at the login flow",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Ada in channel Design");
    expect(worker.shown[0]?.options.body).toBe(
      "can you look at the login flow",
    );
  });

  it("says a room of people is a group", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Ada, Ben, Cara",
        isGroup: true,
        messagePreview: "standup in five",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Ada in group Ada, Ben, Cara");
  });

  /**
   * The two title strings differ by one clause in German, and both name the
   * author and the room. Reading a channel message under the group string
   * tells the reader they are in a group they are not in.
   */
  it("titles a German room message under the string for its own shape", async () => {
    const worker = loadServiceWorker({ isChromium: true, locale: "de" });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        messagePreview: "schaust du dir den Login an",
      }),
    });
    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Ada, Ben, Cara",
        isGroup: true,
        messagePreview: "Standup in fünf",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Ada im Kanal Design");
    expect(worker.shown[1]?.title).toBe("Ada in der Gruppe Ada, Ben, Cara");
  });

  /**
   * A direct room is named after the people in it, so its name is not the
   * author's. Ben's banner for a message from Ada must say Ada, not Ben.
   */
  it("titles a direct message with the author alone", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.directMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Ben",
        messagePreview: "are you free?",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Ada");
    expect(worker.shown[0]?.options.body).toBe("are you free?");
  });

  /**
   * The author is the whole title of a direct message, so a message without
   * one has to fall back rather than show an empty line.
   */
  it("falls back to the app name when a direct message has no author", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.directMessage",
      messageParams: JSON.stringify({ messagePreview: "are you free?" }),
    });
    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.directMessage",
      messageParams: JSON.stringify({
        authorName: "",
        messagePreview: "are you free?",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
    expect(worker.shown[1]?.title).toBe("Sokosumi");
  });

  /** Mirrors the app: a room title names the author too. */
  it("falls back to the app name when a room message has no author", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "",
        roomName: "Design",
        messagePreview: "can you look at the login flow",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
  });

  it.each([undefined, "", "   ", 12, null])(
    "uses the author when the room name is unavailable (%s)",
    async (roomName) => {
      const worker = loadServiceWorker({ isChromium: true });
      for (const messageKey of [
        "Notifications.Chat.roomMessage",
        "Notifications.Chat.mentioned",
      ]) {
        for (const isGroup of [false, true]) {
          await worker.dispatchPush({
            ...MENTION_PUSH,
            messageKey,
            messageParams: JSON.stringify({
              authorName: "Ada",
              roomName,
              isGroup,
              messagePreview: "hello",
            }),
          });
          expect(worker.shown.at(-1)?.title).toBe("Ada");
          expect(worker.shown.at(-1)?.options.body).toBe("hello");
        }
      }
    },
  );

  it.each([undefined, "", 12, null])(
    "keeps chat titles without preview text (%s)",
    async (messagePreview) => {
      const worker = loadServiceWorker({ isChromium: true });
      for (const [messageKey, title, isGroup] of [
        ["Notifications.Chat.roomMessage", "Ada in channel Design", false],
        ["Notifications.Chat.roomMessage", "Ada in group Design", true],
        ["Notifications.Chat.directMessage", "Ada", false],
        ["Notifications.Chat.mentioned", "Ada mentioned you in Design", false],
      ] as const) {
        await worker.dispatchPush({
          ...MENTION_PUSH,
          messageKey,
          messageParams: JSON.stringify({
            authorName: "Ada",
            roomName: "Design",
            isGroup,
            messagePreview,
          }),
        });
        expect(worker.shown.at(-1)?.title).toBe(title);
        expect(worker.shown.at(-1)?.options.body).toBe("");
      }
    },
  );

  /**
   * A title is cut shorter than a body on most platforms, and a task name is
   * long, so every other kind keeps the app name and its line.
   */
  it("leaves a task banner titled with the app name", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      kind: "TASK",
      messageKey: "Notifications.Task.completed",
      messageParams: JSON.stringify({
        coworkerName: "Ada",
        taskName: "Weekly report",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
    expect(worker.shown[0]?.options.body).toBe("Ada completed Weekly report");
  });

  /**
   * Chat's own params on a kind that is not chat. Core writes neither on a
   * task, so this says the key decides the title, not the params beside it.
   */
  it("keeps the app name on a task carrying a chat message's params", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      kind: "TASK",
      messageKey: "Notifications.Task.completed",
      messageParams: JSON.stringify({
        coworkerName: "Ada",
        taskName: "Weekly report",
        authorName: "Ada",
        messagePreview: "done",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
    expect(worker.shown[0]?.options.body).toBe("Ada completed Weekly report");
  });

  /**
   * Every chat title names the author, and a mention's is no different: a
   * blank name would title the banner " mentioned you in General".
   */
  it("keeps the app name on a mention with no author to name", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageParams: JSON.stringify({
        authorName: "",
        roomName: "General",
        messagePreview: "your call",
      }),
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
    expect(worker.shown[0]?.options.body).toBe(" mentioned you in General");
  });

  it("tags an unreadable payload so a replay replaces it", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({});

    expect(worker.shown).toEqual([
      {
        title: "Sokosumi",
        options: {
          body: undefined,
          tag: "sokosumi-notification",
          icon: "/images/app-icons/apple-icon-180.png",
          data: null,
        },
      },
    ]);
    // A bare banner is what a push carrying nothing would look like too, so
    // the report is the only thing that tells the two apart.
    expect(worker.reported).toHaveBeenCalledTimes(1);
  });

  it("skips display on Chromium while a focused app page shows it instead", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [appPage()],
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toEqual([]);
  });

  /**
   * A focused tab that shows no notifications of its own would otherwise turn
   * the push into silence.
   */
  it("displays when the focused page does not show notifications", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [silentPage()],
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toHaveLength(1);
  });

  it("displays on Chromium when the open window is unfocused or hidden", async () => {
    const unfocused = loadServiceWorker({
      isChromium: true,
      windows: [appPage({ focused: false })],
    });
    const hidden = loadServiceWorker({
      isChromium: true,
      windows: [appPage({ visibilityState: "hidden" })],
    });

    await unfocused.dispatchPush(MENTION_PUSH);
    await hidden.dispatchPush(MENTION_PUSH);

    expect(unfocused.shown).toHaveLength(1);
    expect(hidden.shown).toHaveLength(1);
  });

  it("carries the metadata a click needs to route", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      metadata: JSON.stringify({ workspaceId: "workspace-1" }),
    });

    expect(worker.shown[0]?.options.data).toEqual({
      ...MENTION_TARGET,
      metadata: { workspaceId: "workspace-1" },
    });
  });

  it("always displays off Chromium, where skipping revokes the subscription", async () => {
    const worker = loadServiceWorker({
      isChromium: false,
      windows: [appPage()],
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toHaveLength(1);
  });

  /**
   * The subscription is `userVisibleOnly`, so a handler that renders nothing
   * costs the reader a banner and invites the browser's own.
   */
  it("still shows something when the skip check throws", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      matchAllThrows: true,
    });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toEqual([
      {
        title: "Sokosumi",
        options: {
          tag: "sokosumi-notification",
          icon: "/images/app-icons/apple-icon-180.png",
        },
      },
    ]);
    // The fallback banner carries no body and no target, so on its own it
    // looks like a push that simply said nothing. The report is the only
    // record that a real notification was lost.
    expect(worker.reported).toHaveBeenCalledTimes(1);
  });

  it("keeps the banner when the payload names a prototype member", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({ ...MENTION_PUSH, messageKey: "constructor" });

    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]?.options.body).toBeUndefined();
  });
  /**
   * Ably documents the payload as `{ data: … }`, and a transport that
   * re-encodes the map hands `data` over as a string rather than an object.
   * Both shapes must render the reader's own notification, not the generic
   * banner that an unreadable payload falls back to.
   */
  /**
   * The tag is the whole of the grouping: the browser replaces a standing
   * banner carrying the same one. Mirrors `notificationGroupTag` in the app,
   * which renders the banner for an open tab through the same registration.
   */
  it("gives two chat notifications in one room the same tag", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush(MENTION_PUSH);
    await worker.dispatchPush({
      ...MENTION_PUSH,
      id: "notification-2",
      messageKey: "Notifications.Chat.directMessage",
    });

    expect(worker.shown).toHaveLength(2);
    expect(worker.shown[0]?.options.tag).toBe(worker.shown[1]?.options.tag);
  });

  it("gives two rooms different tags", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush(MENTION_PUSH);
    await worker.dispatchPush({
      ...MENTION_PUSH,
      id: "notification-2",
      referenceId: "room-2",
    });

    expect(worker.shown[0]?.options.tag).not.toBe(worker.shown[1]?.options.tag);
  });

  it("tags a job by its own row rather than by a room", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      id: "notification-7",
      kind: "JOB",
      referenceId: "job-1",
      messageKey: "Notifications.Job.completed",
      messageParams: JSON.stringify({ agentName: "Ada", jobName: "Report" }),
    });

    expect(worker.shown[0]?.options.tag).toBe("notification-7");
  });

  /** No room means no group, and one banner per row is where this started. */
  it("tags a chat notification naming no room by its own row", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({ ...MENTION_PUSH, referenceId: "" });

    expect(worker.shown[0]?.options.tag).toBe("notification-1");
  });

  /**
   * A room holds one banner and each push replaces the one standing, so
   * without a count the reader is told about the newest message and never
   * that others arrived behind it. Core counts them, because this worker can
   * query nothing.
   */
  it("says how many messages are waiting in the room", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({ authorName: "Ada", roomName: "Design" }),
      groupCount: "5",
    });

    expect(worker.shown[0]?.options.body).toBe("5 messages in channel Design");
  });

  /** A direct room is named after the other person, so the count names the
   * sender rather than reading "3 messages in Ada". */
  it("names the sender when several direct messages are waiting", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.directMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        messagePreview: "latest message",
      }),
      groupCount: "3",
    });

    expect(worker.shown[0]?.title).toBe("Sokosumi");
    expect(worker.shown[0]?.options.body).toBe("3 messages from Ada");
  });

  it("names the arrival when only it is waiting", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({ ...MENTION_PUSH, groupCount: "1" });

    expect(worker.shown[0]?.title).toBe("Ada mentioned you in General");
    expect(worker.shown[0]?.options.body).toBe("your call");
  });

  /**
   * The room's count, not the row's. A room's row carries what was counted
   * onto that row alone, which reads four messages and a mention as four.
   */
  it("prefers the room's count over the count stored on the row", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        count: 4,
      }),
      groupCount: "5",
    });

    expect(worker.shown[0]?.options.body).toBe("5 messages in channel Design");
  });

  /** A Core that predates the count sends none, and the row's own params are
   * what this worker rendered before there was one. */
  it("falls back to the row's own count when no room count arrives", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        count: 4,
      }),
    });

    expect(worker.shown[0]?.options.body).toBe("4 messages in channel Design");
  });

  /** The count is a string over the wire, and a value that is not a whole
   * number of messages must not print a fraction. */
  it("names the arrival when the count will not read as messages", async () => {
    for (const groupCount of ["", "0", "1.5", "many", "-2"]) {
      const worker = loadServiceWorker({ isChromium: true });

      await worker.dispatchPush({ ...MENTION_PUSH, groupCount });

      expect(worker.shown[0]?.title).toBe("Ada mentioned you in General");
      expect(worker.shown[0]?.options.body).toBe("your call");
    }
  });

  /**
   * A room of three or more people has no name but the list of who is in it,
   * so "Ada, Ben, Cara" alone reads as three people rather than as somewhere
   * a message was written.
   */
  it("names a room of people as a group", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    const params = {
      authorName: "Ada",
      roomName: "Ada, Ben, Cara",
      isGroup: true,
    };
    await worker.dispatchPush({
      ...MENTION_PUSH,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify(params),
      groupCount: "1",
    });
    await worker.dispatchPush({
      ...MENTION_PUSH,
      id: "notification-2",
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: JSON.stringify(params),
      groupCount: "2",
    });

    expect(worker.shown[0]?.title).toBe("Ada in group Ada, Ben, Cara");
    expect(worker.shown[0]?.options.body).toBe("");
    expect(worker.shown[1]?.options.body).toBe(
      "2 messages in group Ada, Ben, Cara",
    );
  });

  /** A job happened once. Core sends it no count. */
  it("counts nothing outside chat", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({
      id: "notification-7",
      kind: "JOB",
      referenceId: "job-1",
      messageKey: "Notifications.Job.completed",
      messageParams: JSON.stringify({ agentName: "Ada", jobName: "Report" }),
    });

    expect(worker.shown[0]?.options.body).toBe("Ada completed Report");
  });

  it("reads push data from a wrapper whose data is a JSON string", async () => {
    const worker = loadServiceWorker({ isChromium: false });

    await worker.dispatchPush({ data: JSON.stringify(MENTION_PUSH) });

    expect(worker.shown).toEqual([
      {
        title: "Ada mentioned you in General",
        options: {
          body: "your call",
          tag: "sokosumi-room:room-1",
          icon: "/images/app-icons/apple-icon-180.png",
          data: MENTION_TARGET,
        },
      },
    ]);
  });
});

/** The URL the worker opens for a click no tab took. */
function appUrlWithTarget(base: string, target: unknown): string {
  const separator = base.endsWith("/") ? "" : "/";
  return `${base}${separator}?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(target))}`;
}

describe("ably-push-sw notificationclick", () => {
  /**
   * A banner outlives the page that asked for it, so the worker owns the
   * click and hands the id back to whichever tab it focuses.
   */
  it("focuses an open tab and sends it the notification id", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [appPage({ focused: false, focus, postMessage })],
    });

    const { close } = await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "sokosumi:notification-click",
      target: MENTION_TARGET,
    });
    expect(worker.openedWindows).toEqual([]);
  });

  /**
   * The window the worker opens has no listener to post to, so the target
   * rides on its URL and the page that comes up routes the click itself:
   * mark-read, the workspace switch, and the message the banner named.
   */
  it("opens the app carrying the target when no tab is open", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(worker.openedWindows).toEqual([
      appUrlWithTarget("/", MENTION_TARGET),
    ]);
  });

  /** A banner with no data names nothing to route to. */
  it("opens the bare app for a banner that carries no target", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchNotificationClick(undefined);

    expect(worker.openedWindows).toEqual(["/"]);
  });

  it("opens the stable branch URL instead of a hashed preview origin", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const branchUrl =
      "https://sokosumi-app-mainnet-git-fix.preview.sokosumi.com";
    const worker = loadServiceWorker({
      isChromium: true,
      appUrl: branchUrl,
      windows: [appPage({ focused: false, focus })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).not.toHaveBeenCalled();
    expect(worker.openedWindows).toEqual([
      appUrlWithTarget(branchUrl, MENTION_TARGET),
    ]);
  });

  /**
   * Focusing a tab that cannot act on the click would drop it: no mark-read,
   * no routing, and no window opened either.
   */
  it("passes over a tab that does not show notifications", async () => {
    const silentFocus = vi.fn().mockResolvedValue(undefined);
    const appFocus = vi.fn().mockResolvedValue(undefined);
    const appPostMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [
        silentPage({ focus: silentFocus }),
        appPage({ focus: appFocus, postMessage: appPostMessage }),
      ],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(silentFocus).not.toHaveBeenCalled();
    expect(appFocus).toHaveBeenCalledTimes(1);
  });

  /**
   * A tab whose channel has detached still handles clicks: it subscribes to
   * them and answers the worker's query from one mount. Requiring a yes here
   * would open a second tab on the home page and leave the notification
   * unread, with the tab that could have handled it still sitting there.
   */
  it("routes the click to a tab that has stopped receiving", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [stalledPage({ focused: false, focus, postMessage })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "sokosumi:notification-click",
      target: MENTION_TARGET,
    });
    expect(worker.openedWindows).toEqual([]);
  });

  it("opens the app when no open tab can act on the click", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [silentPage({ focus })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).not.toHaveBeenCalled();
    expect(worker.openedWindows).toEqual([
      appUrlWithTarget("/", MENTION_TARGET),
    ]);
  });

  /**
   * `focus()` and `openWindow()` both reject with `InvalidAccessError` unless
   * a window in the origin holds transient activation (MDN), and that is a
   * condition of the origin rather than of one tab, so the two usually refuse
   * together. Saying so is all that is left.
   *
   * The withheld target is the point of the test. A click on a notification
   * from another workspace switches the active organization, which every tab
   * shares, so a tab that never came forward would move the reader's front tab
   * into that workspace. The worker cannot tell that click from a
   * same-workspace one, so it withholds from both: a click that goes nowhere
   * is the better failure.
   */
  it("withholds the target from a tab that would not come forward", async () => {
    const focus = vi.fn().mockRejectedValue(new Error("InvalidAccessError"));
    const postMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      openWindowThrows: true,
      windows: [appPage({ focused: false, focus, postMessage })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(worker.openedWindows).toEqual([]);
    expect(worker.reported).toHaveBeenCalledTimes(1);
  });

  /**
   * A click cannot be abandoned because the tab list would not load. The
   * banner is closed by then, so the reader would be left with no window and
   * nothing said.
   */
  it("opens a window when the tab list cannot be read", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      matchAllThrows: true,
      windows: [appPage({ focused: false })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(worker.openedWindows).toEqual([
      appUrlWithTarget("/", MENTION_TARGET),
    ]);
    // A window opened, so the click is not lost and this is not a report.
    // It is still worth a line: the reader lost the tab they had.
    expect(worker.reported).not.toHaveBeenCalled();
    expect(worker.warned).toHaveBeenCalledTimes(1);
  });

  /** With no tab to hand the click to, a refused window is the end of it. */
  it("reports a click it could neither route nor open", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      openWindowThrows: true,
      windows: [],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(worker.openedWindows).toEqual([]);
    expect(worker.reported).toHaveBeenCalledTimes(1);
  });

  /**
   * The missing activation above is the one refusal MDN names, and it stops
   * the new window too. A `focus()` refused for any other reason leaves the
   * window open to try, and the reader gets the app rather than nothing.
   */
  it("opens a window when a tab refuses the focus by itself", async () => {
    const focus = vi.fn().mockRejectedValue(new Error("gone"));
    const postMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [appPage({ focused: false, focus, postMessage })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).toHaveBeenCalledTimes(1);
    // Withheld from the tab that stayed put, carried by the window that
    // opened: a fresh window is nobody's front tab, so the workspace switch
    // the target may cause lands where the reader is looking.
    expect(postMessage).not.toHaveBeenCalled();
    expect(worker.openedWindows).toEqual([
      appUrlWithTarget("/", MENTION_TARGET),
    ]);
  });

  it("still focuses a tab when the banner carries no target", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [appPage({ focused: false, focus, postMessage })],
    });

    await worker.dispatchNotificationClick(null);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("preserves the source creation time for stale clear checks", async () => {
    const worker = loadServiceWorker({ isChromium: false });
    const createdAt = "2026-09-08T10:00:01.000Z";

    await worker.dispatchPush({ ...MENTION_PUSH, createdAt });

    expect(worker.shown[0]?.options.data).toEqual({
      ...MENTION_TARGET,
      createdAt,
    });
  });

  it.each([undefined, null, 123])(
    "keeps targets valid when the creation time is %s",
    async (createdAt) => {
      const worker = loadServiceWorker({ isChromium: false });

      await worker.dispatchPush({ ...MENTION_PUSH, createdAt });

      expect(worker.shown[0]?.options.data).toEqual(MENTION_TARGET);
      expect(
        notificationTargetSchema.safeParse(worker.shown[0]?.options.data)
          .success,
      ).toBe(true);
    },
  );

  it("carries exactly the fields the app's target schema names", async () => {
    const worker = loadServiceWorker({ isChromium: false });

    await worker.dispatchPush({
      ...MENTION_PUSH,
      createdAt: "2026-09-08T10:00:01.000Z",
    });

    // Core encodes this payload, the worker decodes it, and the app validates
    // what a click hands back. Nothing but this holds the three to one list.
    expect(Object.keys(worker.shown[0]?.options.data ?? {}).sort()).toEqual(
      Object.keys(notificationTargetSchema.shape).sort(),
    );
    // The names alone would pass on `{ kind: undefined }`, which is what a
    // Core field dropped from the payload builds. The app rejects that target
    // and the click then does nothing at all, so parse it too.
    expect(
      notificationTargetSchema.safeParse(worker.shown[0]?.options.data).success,
    ).toBe(true);
  });

  it("shows the banner when the focused page says it is not receiving", async () => {
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [stalledPage()],
    });

    await worker.dispatchPush(MENTION_PUSH);

    // The page mounts the listener, so it answers, but its channel is gone.
    // Skipping here would drop the notification on both paths at once.
    expect(worker.shown).toHaveLength(1);
  });

  it("takes over from the previous version as soon as it installs", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    worker.dispatchInstall();

    // Without this the new worker waits for every tab to close, and the old
    // one keeps rendering the message strings it shipped with.
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

/**
 * The worker cannot import from the app, so it holds its own copy of the two
 * rules that decide what a banner says and which banner it replaces. ADR-0023
 * says a test holds the copies to the same answers; this is that test.
 *
 * Without it either copy can be edited alone and both suites stay green, and
 * the reader gets one banner from an open tab and a second from the push for
 * the same conversation.
 */
describe("ably-push-sw mirrors the app's rules", () => {
  /** The content the app renders for the same arrival and room count. */
  function appBanner(
    messageKey: string,
    params: Record<string, unknown>,
    groupCount: number,
  ) {
    const counted: Record<string, unknown> = { ...params, count: groupCount };
    return buildNotificationBannerContent({
      messageKey,
      messageParams: counted,
      appTitle: "Sokosumi",
      translate: (storedKey) => {
        const key = getNotificationMessageTranslationKey(storedKey, counted);
        const template = key
          .split(".")
          .reduce<unknown>(
            (node, name) => (node as Record<string, unknown>)?.[name],
            enMessages,
          );
        if (typeof template !== "string") {
          throw new Error(`No English string for ${key}`);
        }
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          Object.hasOwn(counted, name) ? String(counted[name]) : match,
        );
      },
    });
  }

  const CASES: {
    name: string;
    messageKey: string;
    kind: string;
    referenceId: string;
    params: Record<string, unknown>;
  }[] = [
    {
      name: "a mention",
      messageKey: "Notifications.Chat.mentioned",
      kind: "CHAT",
      referenceId: "room-1",
      params: { authorName: "Ada", roomName: "Design" },
    },
    {
      name: "a direct message",
      messageKey: "Notifications.Chat.directMessage",
      kind: "CHAT",
      referenceId: "room-1",
      params: { authorName: "Ada" },
    },
    {
      name: "a room message",
      messageKey: "Notifications.Chat.roomMessage",
      kind: "CHAT",
      referenceId: "room-1",
      params: { authorName: "Ada", roomName: "Design" },
    },
    {
      name: "a room message in a room of people",
      messageKey: "Notifications.Chat.roomMessage",
      kind: "CHAT",
      referenceId: "room-1",
      params: { authorName: "Ada", roomName: "Ada, Ben, Cara", isGroup: true },
    },
    {
      name: "a chat notification naming no room",
      messageKey: "Notifications.Chat.mentioned",
      kind: "CHAT",
      referenceId: "",
      params: { authorName: "Ada", roomName: "Design" },
    },
    {
      name: "a job",
      messageKey: "Notifications.Job.completed",
      kind: "JOB",
      referenceId: "job-1",
      params: { agentName: "Ada", jobName: "Report" },
    },
    {
      name: "a notification named after a room",
      messageKey: "Notifications.Job.completed",
      kind: "JOB",
      referenceId: "room-1",
      params: { agentName: "Ada", jobName: "Report" },
    },
  ];

  for (const testCase of CASES) {
    it(`tags ${testCase.name} the way the app does`, async () => {
      const worker = loadServiceWorker({ isChromium: true });

      await worker.dispatchPush({
        id: "notification-1",
        kind: testCase.kind,
        referenceId: testCase.referenceId,
        messageKey: testCase.messageKey,
        messageParams: JSON.stringify(testCase.params),
      });

      expect(worker.shown[0]?.options.tag).toBe(
        notificationGroupTag({
          id: "notification-1",
          kind: testCase.kind as never,
          referenceId: testCase.referenceId,
        }),
      );
    });

    it(`writes ${testCase.name} the way the app does, one message and several`, async () => {
      for (const groupCount of [1, 2, 11]) {
        for (const messagePreview of [undefined, "latest message"]) {
          const worker = loadServiceWorker({ isChromium: true });
          const params = { ...testCase.params, messagePreview };
          await worker.dispatchPush({
            id: "notification-1",
            kind: testCase.kind,
            referenceId: testCase.referenceId,
            messageKey: testCase.messageKey,
            messageParams: JSON.stringify(params),
            groupCount: String(groupCount),
          });
          const expected = appBanner(testCase.messageKey, params, groupCount);
          expect(worker.shown[0]?.title).toBe(expected.title);
          expect(worker.shown[0]?.options.body).toBe(expected.body);
        }
      }
    });
  }
});
