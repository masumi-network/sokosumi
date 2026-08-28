import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerShowsNotificationsQuery,
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_ICON_PATH,
  NOTIFICATION_SERVICE_WORKER_URL,
  SHOWS_NOTIFICATIONS_QUERY,
  subscribeNotificationClicks,
} from "@/lib/utils/notification-service-worker";

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

describe("showNotification", () => {
  beforeEach(() => {
    stubPermission("granted");
  });

  it("shows through the registration, tagged and keyed by notification id", async () => {
    const showNotificationSpy = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn().mockResolvedValue({
      active: {},
      showNotification: showNotificationSpy,
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

    expect(register).toHaveBeenCalledWith(NOTIFICATION_SERVICE_WORKER_URL);
    expect(showNotificationSpy).toHaveBeenCalledWith("Sokosumi", {
      body: "Ada mentioned you",
      tag: "notification-1",
      icon: NOTIFICATION_ICON_PATH,
      data: TARGET,
    });
  });

  it("registers once however many banners it shows", async () => {
    const register = vi.fn().mockResolvedValue({
      active: {},
      showNotification: vi.fn().mockResolvedValue(undefined),
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
    const unsubscribe = subscribeNotificationClicks(onClick);
    const emit = (data: unknown) => {
      for (const listener of listeners) {
        listener({ data } as MessageEvent);
      }
    };

    emit({ type: "something-else", target: TARGET });
    emit({ type: NOTIFICATION_CLICK_MESSAGE });
    emit({ type: NOTIFICATION_CLICK_MESSAGE, target: { id: "" } });
    emit({ type: NOTIFICATION_CLICK_MESSAGE, target: TARGET });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(TARGET);

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
