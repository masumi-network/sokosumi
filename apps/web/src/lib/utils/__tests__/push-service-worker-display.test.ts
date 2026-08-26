import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { notificationTargetSchema } from "../notification-service-worker";

/**
 * The worker ships as a plain script in `public/`, so it cannot be imported.
 * These tests run its source in a sandbox that stands in for the service
 * worker global, and drive it through a real `push` event.
 */
const SERVICE_WORKER_PATH = join(process.cwd(), "public", "ably-push-sw.js");

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
function stalledPage(
  overrides: Partial<WindowClientStub> = {},
): WindowClientStub {
  return {
    focused: true,
    visibilityState: "visible",
    ...overrides,
    postMessage: (_message: unknown, transfer?: unknown[]) => {
      const port = transfer?.[0] as MessagePort | undefined;
      port?.postMessage(false);
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
  locale,
}: {
  isChromium: boolean;
  windows?: WindowClientStub[];
  matchAllThrows?: boolean;
  locale?: string;
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: ShownNotification[] = [];
  const openedWindows: string[] = [];
  const skipWaiting = vi.fn();

  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting,
    ...(locale
      ? { cookieStore: { get: async () => ({ value: locale }) } }
      : {}),
    navigator: {
      language: "en-US",
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
    }),
  );

  async function dispatchPush(data: Record<string, string>) {
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
  };
}

const MENTION_PUSH = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  messageParams: JSON.stringify({ authorName: "Ada", roomName: "General" }),
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

    expect(worker.shown[0]?.options.body).toBe("Ada mentioned you in General");
  });

  it("renders the localized message tagged with the notification id", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush(MENTION_PUSH);

    expect(worker.shown).toEqual([
      {
        title: "Sokosumi",
        options: {
          body: "Ada mentioned you in General",
          tag: "notification-1",
          icon: "/images/app-icons/apple-icon-180.png",
          data: MENTION_TARGET,
        },
      },
    ]);
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
  });

  it("keeps the banner when the payload names a prototype member", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchPush({ ...MENTION_PUSH, messageKey: "constructor" });

    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]?.options.body).toBeUndefined();
  });
});

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

  it("opens the app when no tab is open", async () => {
    const worker = loadServiceWorker({ isChromium: true });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(worker.openedWindows).toEqual(["/"]);
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

  it("opens the app when no open tab can act on the click", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const worker = loadServiceWorker({
      isChromium: true,
      windows: [silentPage({ focus })],
    });

    await worker.dispatchNotificationClick(MENTION_TARGET);

    expect(focus).not.toHaveBeenCalled();
    expect(worker.openedWindows).toEqual(["/"]);
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

  it("carries exactly the fields the app's target schema names", async () => {
    const worker = loadServiceWorker({ isChromium: false });

    await worker.dispatchPush(MENTION_PUSH);

    // Core encodes this payload, the worker decodes it, and the app validates
    // what a click hands back. Nothing but this holds the three to one list.
    expect(Object.keys(worker.shown[0]?.options.data ?? {}).sort()).toEqual(
      Object.keys(notificationTargetSchema.shape).sort(),
    );
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
