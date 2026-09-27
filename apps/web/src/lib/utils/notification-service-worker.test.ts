import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerShowsNotificationsQuery,
  clearNotificationTargetFromUrl,
  getNotificationServiceWorkerUrl,
  isPushInstallable,
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_ICON_PATH,
  NOTIFICATION_SERVICE_WORKER_URL,
  NOTIFICATION_TARGET_PARAM,
  notificationGroupTag,
  readNotificationTargetFromUrl,
  SHOWS_NOTIFICATIONS_QUERY,
  subscribeNotificationClicks,
} from "@/lib/utils/notification-service-worker";

const envMock = vi.hoisted(() => ({
  NEXT_PUBLIC_VERCEL_ENV: undefined as
    | "production"
    | "preview"
    | "development"
    | undefined,
  NEXT_PUBLIC_VERCEL_BRANCH_URL: undefined as string | undefined,
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: undefined as string | undefined,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => envMock,
}));

const TARGET = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  metadata: null,
} as const;

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);
const originalNotification = globalThis.Notification;

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value,
  });
}

function stubPermission(permission: NotificationPermission) {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: { permission, requestPermission: vi.fn() },
  });
}

/** The module caches its registration, so each test needs a fresh copy. */
async function importFresh() {
  vi.resetModules();
  return import("@/lib/utils/notification-service-worker");
}

afterEach(() => {
  // Several tests silence `console.error` and none of them put it back, and
  // this project sets no `restoreMocks`. Left alone, the first silencer stubs
  // the console for every test after it in the file, so one that means to
  // assert on a report is asserting on someone else's stub.
  vi.restoreAllMocks();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: originalNotification,
  });
});

beforeEach(() => {
  envMock.NEXT_PUBLIC_VERCEL_ENV = undefined;
  envMock.NEXT_PUBLIC_VERCEL_BRANCH_URL = undefined;
  envMock.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = undefined;
});

describe("getNotificationServiceWorkerUrl", () => {
  it("passes the stable branch URL to a preview worker", () => {
    envMock.NEXT_PUBLIC_VERCEL_ENV = "preview";
    envMock.NEXT_PUBLIC_VERCEL_BRANCH_URL =
      "https://sokosumi-app-mainnet-git-fix.preview.sokosumi.com";

    expect(getNotificationServiceWorkerUrl()).toBe(
      "/ably-push-sw.js?appUrl=https%3A%2F%2Fsokosumi-app-mainnet-git-fix.preview.sokosumi.com",
    );
  });

  it("passes the canonical project URL to a production worker", () => {
    envMock.NEXT_PUBLIC_VERCEL_ENV = "production";
    envMock.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL =
      "https://app.sokosumi.com";

    expect(getNotificationServiceWorkerUrl()).toBe(
      "/ably-push-sw.js?appUrl=https%3A%2F%2Fapp.sokosumi.com",
    );
  });
});

describe("showNotification", () => {
  beforeEach(() => {
    stubPermission("granted");
  });

  it("shows through the registration, tagged by the banner's group", async () => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn().mockResolvedValue({
      active: {},
      showNotification: showNotificationSpy,
      // A real registration always has this, so a stub without it sends the
      // banner down the lookup's failure path and tests nothing this names.
      getNotifications: vi.fn().mockResolvedValue([]),
    });
    stubServiceWorker({ register });

    const module = await importFresh();
    await expect(
      module.showNotification({
        title: "Sokosumi",
        body: "Ada mentioned you",
        target: TARGET,
      }),
    ).resolves.toBe(true);

    // The option is the pin, not noise: the default lets the HTTP cache
    // answer for the catalog the worker imports. It is not the whole
    // guarantee, because Ably's own registration can reset it, so the
    // catalog's `Cache-Control` carries the rest.
    expect(register).toHaveBeenCalledWith(NOTIFICATION_SERVICE_WORKER_URL, {
      updateViaCache: "none",
    });
    expect(showNotificationSpy).toHaveBeenCalledWith("Sokosumi", {
      body: "Ada mentioned you",
      tag: "sokosumi-room:room-1",
      icon: NOTIFICATION_ICON_PATH,
      data: TARGET,
    });
  });

  /**
   * A room is one tag, so the second message replaces the first one's banner.
   * Without `renotify` that replacement is silent, which is the whole reason a
   * busy room only ever made one sound.
   */
  it("asks to re-alert when it replaces a banner for a different notification", async () => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    const getNotifications = vi
      .fn()
      .mockResolvedValue([{ data: { ...TARGET, id: "older-message" } }]);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications,
      }),
    });

    const module = await importFresh();
    await module.showNotification({
      title: "Sokosumi",
      body: "Ada mentioned you",
      target: TARGET,
    });

    expect(getNotifications).toHaveBeenCalledWith({
      tag: "sokosumi-room:room-1",
    });
    expect(showNotificationSpy.mock.calls[0]?.[1]).toMatchObject({
      renotify: true,
    });
  });

  /**
   * The same notification from the other source. An open tab draws its banner
   * from the Ably event and the push replaces it by tag on purpose, so a
   * re-alert here would sound twice for one message.
   */
  it("stays silent when it replaces the banner for the same notification", async () => {
    const target = { ...TARGET, metadata: { messageId: "message-1" } };
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications: vi.fn().mockResolvedValue([{ data: target }]),
      }),
    });

    const module = await importFresh();
    await module.showNotification({
      title: "Sokosumi",
      body: "Ada mentioned you",
      target,
    });

    expect(showNotificationSpy.mock.calls[0]?.[1]).not.toHaveProperty(
      "renotify",
    );
  });

  /**
   * Nothing is being replaced, so a fresh banner alerts on its own and the
   * flag would only be noise.
   */
  it("asks for no re-alert when the tag shows nothing yet", async () => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications: vi.fn().mockResolvedValue([]),
      }),
    });

    const module = await importFresh();
    await module.showNotification({
      title: "Sokosumi",
      body: "Ada mentioned you",
      target: TARGET,
    });

    expect(showNotificationSpy.mock.calls[0]?.[1]).not.toHaveProperty(
      "renotify",
    );
  });

  /**
   * A failed lookup prefers an extra alert over a silent replacement.
   */
  it("re-alerts when the existing banner cannot be checked", async () => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications: vi.fn().mockRejectedValue(new Error("nope")),
      }),
    });

    const module = await importFresh();
    await expect(
      module.showNotification({
        title: "Sokosumi",
        body: "Ada mentioned you",
        target: TARGET,
      }),
    ).resolves.toBe(true);

    expect(showNotificationSpy.mock.calls[0]?.[1]).toHaveProperty(
      "renotify",
      true,
    );
  });

  it.each([
    {
      name: "new message",
      previous: { messageId: "message-1" },
      incoming: { messageId: "message-2" },
    },
    {
      name: "older banner without message identity",
      previous: null,
      incoming: { messageId: "message-2" },
    },
    {
      name: "arrival without message identity",
      previous: { messageId: "message-1" },
      incoming: null,
    },
    {
      name: "empty message identity",
      previous: { messageId: "" },
      incoming: { messageId: "" },
    },
  ])("re-alerts a grouped row for $name", async ({ previous, incoming }) => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications: vi
          .fn()
          .mockResolvedValue([{ data: { ...TARGET, metadata: previous } }]),
      }),
    });
    const module = await importFresh();
    await module.showNotification({
      title: "Sokosumi",
      body: "New arrival",
      target: { ...TARGET, metadata: incoming },
    });
    expect(showNotificationSpy.mock.calls[0]?.[1]).toHaveProperty(
      "renotify",
      true,
    );
  });

  it("keeps duplicate non-chat notifications silent", async () => {
    const target = { ...TARGET, kind: "SYSTEM" as const };
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      register: vi.fn().mockResolvedValue({
        active: {},
        showNotification: showNotificationSpy,
        getNotifications: vi.fn().mockResolvedValue([{ data: target }]),
      }),
    });
    const module = await importFresh();
    await module.showNotification({
      title: "Sokosumi",
      body: "New arrival",
      target,
    });
    expect(showNotificationSpy.mock.calls[0]?.[1]).not.toHaveProperty(
      "renotify",
    );
  });

  it("registers once however many banners it shows", async () => {
    const register = vi.fn().mockResolvedValue({
      active: {},
      showNotification: vi.fn().mockResolvedValue(undefined),
      getNotifications: vi.fn().mockResolvedValue([]),
    });
    stubServiceWorker({ register });

    const module = await importFresh();
    await module.showNotification({ title: "t", body: "b", target: TARGET });
    await module.showNotification({
      title: "t",
      body: "b",
      target: { ...TARGET, id: "notification-2" },
    });

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when permission is not granted", async () => {
    stubPermission("denied");
    const register = vi.fn();
    stubServiceWorker({ register });

    const module = await importFresh();
    await expect(
      module.showNotification({ title: "t", body: "b", target: TARGET }),
    ).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it("shows nothing when the worker cannot be registered", async () => {
    stubServiceWorker({
      register: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const module = await importFresh();
    await expect(
      module.showNotification({ title: "t", body: "b", target: TARGET }),
    ).resolves.toBe(false);
  });

  it("shows nothing when the browser has no service worker support", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    const module = await importFresh();
    await expect(
      module.showNotification({ title: "t", body: "b", target: TARGET }),
    ).resolves.toBe(false);
  });
});

describe("subscribeNotificationClicks", () => {
  it("reports the id the worker sends and ignores other messages", () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    stubServiceWorker({
      addEventListener: (_type: string, handler: (e: MessageEvent) => void) => {
        listeners.add(handler);
      },
      removeEventListener: (
        _type: string,
        handler: (e: MessageEvent) => void,
      ) => {
        listeners.delete(handler);
      },
    });

    const onClick = vi.fn();
    // The worker's own query reaches this listener too, so silence is the
    // right answer to it. A click whose target will not parse is the case
    // worth reporting, and the two are told apart below.
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribe = subscribeNotificationClicks(onClick);
    const emit = (data: unknown) => {
      for (const listener of listeners) {
        listener({ data } as MessageEvent);
      }
    };

    emit({ type: "something-else", target: TARGET });
    emit({ type: SHOWS_NOTIFICATIONS_QUERY });
    expect(reported).not.toHaveBeenCalled();

    emit({ type: NOTIFICATION_CLICK_MESSAGE });
    emit({ type: NOTIFICATION_CLICK_MESSAGE, target: { id: "" } });
    emit({ type: NOTIFICATION_CLICK_MESSAGE, target: TARGET });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(TARGET);
    // A banner the worker rendered but this build cannot route leaves the
    // reader with a focused tab and nothing else, so it must not be silent.
    expect(reported).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});

describe("hasWebPushSubscription", () => {
  function stubRegistration(getSubscription: () => Promise<unknown>) {
    stubServiceWorker({
      register: vi.fn(),
      getRegistration: vi
        .fn()
        .mockResolvedValue({ pushManager: { getSubscription } }),
    });
  }

  /** Asking whether this browser is subscribed must install nothing. */
  it("does not register a worker", async () => {
    const register = vi.fn();
    stubServiceWorker({
      register,
      getRegistration: vi.fn().mockResolvedValue(undefined),
    });

    const module = await importFresh();
    await expect(module.hasWebPushSubscription()).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it("reports a subscription when the registration holds one", async () => {
    stubRegistration(() => Promise.resolve({ endpoint: "https://x" }));

    const module = await importFresh();
    await expect(module.hasWebPushSubscription()).resolves.toBe(true);
  });

  it("reports none when the registration has no subscription", async () => {
    stubRegistration(() => Promise.resolve(null));

    const module = await importFresh();
    await expect(module.hasWebPushSubscription()).resolves.toBe(false);
  });

  it("reports none when the lookup throws", async () => {
    stubRegistration(() => Promise.reject(new Error("blocked")));

    const module = await importFresh();
    await expect(module.hasWebPushSubscription()).resolves.toBe(false);
  });

  it("reports none when the browser has no service worker support", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    const module = await importFresh();
    await expect(module.hasWebPushSubscription()).resolves.toBe(false);
  });
});

describe("getNotificationServiceWorker", () => {
  /**
   * Caching a failure would cost the tab every later banner over one bad
   * moment, so the next call tries again.
   */
  it("retries after a failed registration", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValue({ active: {} });
    stubServiceWorker({ register });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const module = await importFresh();
    await expect(module.getNotificationServiceWorker()).resolves.toBeNull();
    await expect(module.getNotificationServiceWorker()).resolves.not.toBeNull();
    expect(register).toHaveBeenCalledTimes(2);
  });

  /**
   * A registration still installing is awaited through `ready`. Returning that
   * promise rather than awaiting it would settle it after the `try` is over,
   * so the failure would be cached as a rejection and every later banner in
   * the tab would throw instead of reporting that it showed nothing.
   */
  it("retries after the worker never becomes active", async () => {
    const register = vi.fn().mockResolvedValue({ active: null });
    stubServiceWorker({
      register,
      get ready() {
        return register.mock.calls.length > 1
          ? Promise.resolve({ active: {} })
          : Promise.reject(new Error("never activated"));
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const module = await importFresh();
    await expect(module.getNotificationServiceWorker()).resolves.toBeNull();
    await expect(module.getNotificationServiceWorker()).resolves.not.toBeNull();
    expect(register).toHaveBeenCalledTimes(2);
  });
});

/**
 * The parts of the worker's query the listener reads. Narrower than
 * `MessageEvent`, whose readonly `ports` a plain object cannot satisfy.
 */
interface QueryMessage {
  data: { type: string };
  ports: { postMessage: (answer: boolean) => void }[];
}

describe("answerShowsNotificationsQuery", () => {
  it("answers the worker's query and stops when unsubscribed", () => {
    const listeners = new Set<(event: QueryMessage) => void>();
    stubServiceWorker({
      addEventListener: (_type: string, handler: (e: QueryMessage) => void) => {
        listeners.add(handler);
      },
      removeEventListener: (
        _type: string,
        handler: (e: QueryMessage) => void,
      ) => {
        listeners.delete(handler);
      },
    });

    let showsNotifications = true;
    const stop = answerShowsNotificationsQuery(() => showsNotifications);
    const port = { postMessage: vi.fn() };
    const ask = (type: string) => {
      for (const listener of listeners) {
        listener({ data: { type }, ports: [port] });
      }
    };

    ask("something-else");
    expect(port.postMessage).not.toHaveBeenCalled();

    ask(SHOWS_NOTIFICATIONS_QUERY);
    expect(port.postMessage).toHaveBeenCalledWith(true);

    // Read at answer time: a page that mounted the listener can stop
    // receiving while it sits there, and must then say so.
    showsNotifications = false;
    ask(SHOWS_NOTIFICATIONS_QUERY);
    expect(port.postMessage).toHaveBeenLastCalledWith(false);

    stop();
    expect(listeners.size).toBe(0);
  });
});

describe("notificationGroupTag", () => {
  it("groups a chat notification by its room", () => {
    expect(notificationGroupTag(TARGET)).toContain("room-1");
  });

  /**
   * The rule is not given the message key, so a mention, a direct message and
   * a room's counted row cannot be told apart here. That is the grouping: one
   * room, one banner, whichever of the three arrived.
   */
  it("gives two chat notifications in one room the same tag", () => {
    expect(notificationGroupTag({ ...TARGET, id: "notification-2" })).toBe(
      notificationGroupTag(TARGET),
    );
  });

  it("gives two rooms different tags", () => {
    expect(
      notificationGroupTag({
        ...TARGET,
        id: "notification-2",
        referenceId: "room-2",
      }),
    ).not.toBe(notificationGroupTag(TARGET));
  });

  /** A room id and a notification id come from one generator, so a bare room
   * id could collide with the row tag a job banner carries. */
  it("cannot collide with the row tag of a notification named after a room", () => {
    expect(
      notificationGroupTag({
        id: "room-1",
        kind: "JOB",
        referenceId: "job-1",
      }),
    ).not.toBe(notificationGroupTag(TARGET));
  });

  it("gives a non-chat notification a tag of its own", () => {
    const job = {
      id: "notification-9",
      kind: "JOB",
      referenceId: "job-1",
    } as const;

    expect(notificationGroupTag(job)).toBe("notification-9");
    expect(notificationGroupTag({ ...job, id: "notification-10" })).not.toBe(
      notificationGroupTag(job),
    );
  });

  /** Without a room there is no group, and one banner per row is the state
   * this replaced rather than a worse one. */
  it("falls back to the row when a chat notification names no room", () => {
    expect(notificationGroupTag({ ...TARGET, referenceId: "" })).toBe(
      "notification-1",
    );
  });
});

describe("closeNotificationGroup", () => {
  const READ_AT = "2026-09-08T12:00:01.000Z";
  const CLEARED = { ...TARGET, readAt: READ_AT };

  function stubBanners(banners: { close: () => void; data?: unknown }[]) {
    const getNotifications = vi.fn().mockResolvedValue(banners);
    stubServiceWorker({
      register: vi.fn(),
      getRegistration: vi.fn().mockResolvedValue({ getNotifications }),
    });
    return getNotifications;
  }

  it("closes every banner the group holds", async () => {
    const first = {
      data: { ...TARGET, createdAt: "2026-09-08T12:00:00.000Z" },
      close: vi.fn(),
    };
    const second = {
      data: {
        ...TARGET,
        id: "notification-2",
        createdAt: "2026-09-08T12:00:00.500Z",
      },
      close: vi.fn(),
    };
    const getNotifications = stubBanners([first, second]);

    const module = await importFresh();
    await module.closeNotificationGroup(CLEARED);

    expect(getNotifications).toHaveBeenCalledWith({
      tag: "sokosumi-room:room-1",
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("preserves a newer unread banner when an earlier clear lookup finishes late", async () => {
    stubPermission("granted");
    let shown: { id: string; createdAt?: string } | null = null;
    const registration = {
      active: {},
      showNotification: async (
        _title: string,
        options: { data: typeof TARGET & { createdAt?: string } },
      ) => {
        shown = options.data;
      },
      getNotifications: async () =>
        shown === null
          ? []
          : [
              {
                data: shown,
                close: () => {
                  shown = null;
                },
              },
            ],
    };
    const lookup = Promise.withResolvers<typeof registration>();
    stubServiceWorker({
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockReturnValue(lookup.promise),
    });
    const module = await importFresh();
    await module.getNotificationServiceWorker();
    const clearing = module.closeNotificationGroup(CLEARED);
    const newer = {
      ...TARGET,
      id: "new-unread-row",
      createdAt: "2026-09-08T12:00:02.000Z",
    };
    await module.showNotification({
      title: "Sokosumi",
      body: "New message",
      target: newer,
    });
    expect(shown).toEqual(newer);
    lookup.resolve(registration);
    await clearing;
    expect(shown).toEqual(newer);
  });

  it.each(["2026-09-08T12:00:02.000Z", READ_AT])(
    "preserves an unread banner created at %s when an old cleared row arrives late",
    async (createdAt) => {
      const banner = {
        data: { ...TARGET, id: "new-unread-row", createdAt },
        close: vi.fn(),
      };
      stubBanners([banner]);
      const module = await importFresh();
      await module.closeNotificationGroup(CLEARED);
      expect(banner.close).not.toHaveBeenCalled();
    },
  );

  it("closes an older untimestamped banner only when its own row was cleared", async () => {
    const same = { data: TARGET, close: vi.fn() };
    const other = { data: { ...TARGET, id: "other-row" }, close: vi.fn() };
    stubBanners([same, other]);
    const module = await importFresh();
    await module.closeNotificationGroup(CLEARED);
    expect(same.close).toHaveBeenCalledTimes(1);
    expect(other.close).not.toHaveBeenCalled();
  });

  it.each([null, "invalid"])(
    "does not infer ordering from readAt %s",
    async (readAt) => {
      const banner = {
        data: {
          ...TARGET,
          id: "other-row",
          createdAt: "2026-09-08T12:00:00.000Z",
        },
        close: vi.fn(),
      };
      stubBanners([banner]);
      const module = await importFresh();
      await module.closeNotificationGroup({ ...CLEARED, readAt });
      expect(banner.close).not.toHaveBeenCalled();
    },
  );

  /** The tag is the filter, so a group with nothing standing closes nothing
   * rather than reaching for another room's banner. */
  it("closes nothing when the group holds no banner", async () => {
    const getNotifications = stubBanners([]);

    const module = await importFresh();
    await expect(
      module.closeNotificationGroup({ ...CLEARED, referenceId: "room-2" }),
    ).resolves.toBeUndefined();
    expect(getNotifications).toHaveBeenCalledWith({
      tag: "sokosumi-room:room-2",
    });
  });

  /** Reading a room must not install a worker for a reader who never turned
   * notifications on. */
  it("does not register a worker", async () => {
    const register = vi.fn();
    stubServiceWorker({
      register,
      getRegistration: vi.fn().mockResolvedValue(undefined),
    });

    const module = await importFresh();
    await module.closeNotificationGroup(CLEARED);

    expect(register).not.toHaveBeenCalled();
  });

  it("survives a browser that cannot list its banners", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubServiceWorker({
      register: vi.fn(),
      getRegistration: vi.fn().mockResolvedValue({
        getNotifications: vi.fn().mockRejectedValue(new Error("nope")),
      }),
    });

    const module = await importFresh();
    await expect(
      module.closeNotificationGroup(CLEARED),
    ).resolves.toBeUndefined();
  });

  it("does nothing when the browser has no service worker support", async () => {
    stubServiceWorker(undefined);

    const module = await importFresh();
    await expect(
      module.closeNotificationGroup(CLEARED),
    ).resolves.toBeUndefined();
  });
});

describe("readNotificationTargetFromUrl", () => {
  function setUrl(search: string) {
    window.history.replaceState({}, "", `/chat${search}`);
  }

  /**
   * Left on the URL, because until the notification is open the URL is the
   * only copy of it anything outside the reading component holds. A sign-in
   * redirect is built from `window.location`, so spending it here would lose
   * the notification whenever the session turns out to be gone.
   */
  it("reads the target the worker put on the URL and leaves it there", () => {
    const search = `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}&keep=1`;
    setUrl(search);

    expect(readNotificationTargetFromUrl()).toEqual(TARGET);
    expect(window.location.search).toBe(search);
  });

  it("leaves a URL that carries no target alone", () => {
    setUrl("?keep=1");

    expect(readNotificationTargetFromUrl()).toBeNull();
    expect(window.location.search).toBe("?keep=1");
  });

  /**
   * A hand-typed or truncated parameter names no notification, so it has
   * nothing to carry across a sign-in. Spending it keeps a string that can
   * never work out of the address bar and out of every link built from it.
   */
  it("spends a target that will not parse and reports nothing", () => {
    setUrl(`?${NOTIFICATION_TARGET_PARAM}=not-json&keep=1`);

    expect(readNotificationTargetFromUrl()).toBeNull();
    expect(window.location.search).toBe("?keep=1");
  });

  it("spends a target whose shape the app cannot route", () => {
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify({ id: "" }))}`,
    );

    expect(readNotificationTargetFromUrl()).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("clearNotificationTargetFromUrl", () => {
  function setUrl(search: string) {
    window.history.replaceState({}, "", `/chat${search}`);
  }

  it("spends the target and keeps every other parameter", () => {
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}&keep=1`,
    );

    clearNotificationTargetFromUrl();

    expect(window.location.search).toBe("?keep=1");
  });

  /**
   * Called on every open, including the ones a posted click routes, where
   * there was never a parameter. A `replaceState` for nothing would still
   * push a history entry past whatever the page had already replaced.
   */
  it("leaves a URL that carries no target alone", () => {
    setUrl("?keep=1");
    const before = window.history.length;

    clearNotificationTargetFromUrl();

    expect(window.location.search).toBe("?keep=1");
    expect(window.history.length).toBe(before);
  });
});

/** What an iPad sends, and what Request Desktop Website gives an iPhone. */
const DESKTOP_MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

describe("isPushInstallable", () => {
  const originalPushManager = Object.getOwnPropertyDescriptor(
    window,
    "PushManager",
  );

  /**
   * A browser described by what it has, which is how the read describes one.
   *
   * `standalone` takes the three values the property really has: absent on
   * every engine but WebKit for iOS and iPadOS, false in a tab there, true in
   * the installed app.
   */
  function stubBrowser({
    push,
    standalone,
    userAgent = DESKTOP_MAC_USER_AGENT,
  }: {
    push: boolean;
    standalone: boolean | undefined;
    userAgent?: string;
  }) {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: userAgent,
    });
    stubServiceWorker({});
    stubPermission("default");
    if (push) {
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: class {},
      });
    } else {
      Reflect.deleteProperty(window, "PushManager");
    }
    if (standalone === undefined) {
      Reflect.deleteProperty(navigator, "standalone");
    } else {
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: standalone,
      });
    }
  }

  afterEach(() => {
    if (originalPushManager) {
      Object.defineProperty(window, "PushManager", originalPushManager);
    } else {
      Reflect.deleteProperty(window, "PushManager");
    }
    Reflect.deleteProperty(navigator, "standalone");
    // Deleted rather than put back. `userAgent` lives on the prototype, so
    // there is no own descriptor to save, and a saved `undefined` restored
    // nothing: the stub outlived the test that set it.
    Reflect.deleteProperty(navigator, "userAgent");
  });

  it("offers the install to an iPhone tab outside the installed app", () => {
    stubBrowser({ push: false, standalone: false });

    expect(isPushInstallable()).toBe(true);
  });

  /**
   * The read has to survive the user agent, because on an iPad it is Safari's
   * macOS one and on an iPhone it is whatever Request Desktop Website makes
   * it. This case is the previous one wearing a desktop string, so it fails
   * the day anyone puts a user-agent test in front of the property.
   */
  it("offers it to an iPad asking for the desktop site", () => {
    // The default user agent here is Safari's macOS one, which is what an
    // iPad sends. The property answers over it.
    stubBrowser({ push: false, standalone: false });

    expect(isPushInstallable()).toBe(true);
  });

  /**
   * Since 16.4 these can add a web app to the Home Screen too, and they may
   * not set the property Safari sets. Nothing about the browser separates one
   * from an Android web view, so the name is the only thing left to read, and
   * it is read here alone: where the property answers, this never runs.
   */
  it.each([
    [
      "Chrome for iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox for iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Edge for iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.0.0 Mobile/15E148 Safari/605.1.15",
    ],
  ])("offers it to %s, which sets no standalone property", (_name, agent) => {
    stubBrowser({ push: false, standalone: undefined, userAgent: agent });

    expect(isPushInstallable()).toBe(true);
  });

  /**
   * The names that must not match. Desktop Chrome says `Chrome`, desktop Edge
   * `Edg`, Android Chrome `Chrome` with `Android`: a token test that caught
   * any of them would put an iPhone instruction on a platform the ticket puts
   * out of scope.
   */
  it.each([
    [
      "desktop Chrome",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    [
      "desktop Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    ],
    [
      "Android Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
    [
      "an Android in-app web view",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A]",
    ],
  ])("stays quiet on %s", (_name, agent) => {
    stubBrowser({ push: false, standalone: undefined, userAgent: agent });

    expect(isPushInstallable()).toBe(false);
  });

  /**
   * Chrome for iOS keeps its token when the reader asks for the desktop site,
   * and the rest of the string becomes Safari's macOS one. The reader is on
   * the same phone either way, so the answer must not move.
   */
  it("offers it to Chrome for iOS asking for the desktop site", () => {
    stubBrowser({
      push: false,
      standalone: undefined,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/85 Version/11.1.1 Safari/605.1.15",
    });

    expect(isPushInstallable()).toBe(true);
  });

  /**
   * The property wins where it is set. An installed app that named itself in
   * the user agent must not be sent to install itself again.
   */
  it("lets the property overrule the name it ships under", () => {
    stubBrowser({
      push: false,
      standalone: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
    });

    expect(isPushInstallable()).toBe(false);
  });

  /**
   * Every engine that is not WebKit for iOS, which is one case because the
   * property is missing on all of them: an Android in-app web view, a
   * touchscreen laptop on a browser too old for push, a plain desktop. The
   * first two have a service worker, no push and five touch points, and are
   * the reason this asks for the Apple property rather than for touch.
   */
  it("stays quiet wherever neither the property nor a name says iOS", () => {
    stubBrowser({ push: false, standalone: undefined });

    expect(isPushInstallable()).toBe(false);
  });

  it("stays quiet inside an installed app that still has no push", () => {
    // iOS below 16.4. The app is on the Home Screen already, so telling the
    // reader to put it there would name a step they have taken.
    stubBrowser({ push: false, standalone: true });

    expect(isPushInstallable()).toBe(false);
  });

  it("stays quiet where push already works", () => {
    stubBrowser({ push: true, standalone: false });

    expect(isPushInstallable()).toBe(false);
  });

  it("stays quiet with no service worker to receive through", () => {
    stubBrowser({ push: false, standalone: false });
    stubServiceWorker(undefined);
    Reflect.deleteProperty(navigator, "serviceWorker");

    expect(isPushInstallable()).toBe(false);
  });
});
