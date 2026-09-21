import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => ({ subscribed: false }));
const activate = vi.hoisted(() => vi.fn());
const deactivate = vi.hoisted(() => vi.fn());
const subscribeDevice = vi.hoisted(() => vi.fn());
const unsubscribeDevice = vi.hoisted(() => vi.fn());

vi.mock("../push-client.client", () => ({
  createAblyPushClient: () => ({
    getDevice: async () => ({
      deviceIdentityToken: localStorage.getItem(
        "ably.push.deviceIdentityToken",
      ),
    }),
    push: { activate, deactivate },
    channels: { get: () => ({ push: { subscribeDevice, unsubscribeDevice } }) },
  }),
}));
vi.mock("../push-device-health.client", () => ({
  pushDeviceNeedsReset: async () => false,
  isMissingPushDevice: () => false,
}));
vi.mock("../current-notifications-channel.client", () => ({
  makeCurrentUserNotificationsChannelName: (userId: string) => userId,
}));
vi.mock("@/lib/utils/notification-service-worker", () => ({
  isPushSupported: () => true,
  hasWebPushSubscription: async () => browser.subscribed,
  getExistingNotificationServiceWorker: async () => ({
    pushManager: {
      getSubscription: async () =>
        browser.subscribed
          ? {
              unsubscribe: async () => {
                browser.subscribed = false;
                return true;
              },
            }
          : null,
    },
  }),
}));

const TOKEN_KEY = "ably.push.deviceIdentityToken";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  browser.subscribed = false;
  activate.mockImplementation(async () => {
    browser.subscribed = true;
    localStorage.setItem(TOKEN_KEY, "new-token");
  });
  deactivate.mockImplementation(async () => localStorage.removeItem(TOKEN_KEY));
  subscribeDevice.mockResolvedValue(undefined);
  unsubscribeDevice.mockResolvedValue(undefined);

  // Separate module instances model tabs. The browser lock is shared.
  let previous: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: <T>(name: string, callback: (lock: Lock) => Promise<T>) => {
        const next = previous.then(() => callback({ name, mode: "exclusive" }));
        previous = next.catch(() => {});
        return next;
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("push lifecycle across queued work and tabs", () => {
  it("keeps push off when another tab disables during repair", async () => {
    const tabA = await import("../push-activation.client");
    const pause = deferred();
    activate.mockImplementationOnce(async () => {
      await pause.promise;
      browser.subscribed = true;
      localStorage.setItem(TOKEN_KEY, "late-token");
    });
    const repairing = tabA.activatePush("reader", { readerInitiated: false });
    await tick();
    vi.resetModules();
    const tabB = await import("../push-activation.client");
    const disabling = tabB.deactivatePush("reader");
    await tick();
    pause.resolve();
    const [repaired] = await Promise.all([repairing, disabling]);
    expect(repaired).toBe(false);
    expect(browser.subscribed).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("gives an explicit enable a new run after another tab cancels repair", async () => {
    const tabA = await import("../push-activation.client");
    const pause = deferred();
    activate.mockImplementationOnce(async () => {
      await pause.promise;
      browser.subscribed = true;
      localStorage.setItem(TOKEN_KEY, "late-token");
    });
    const repairing = tabA.activatePush("reader", { readerInitiated: false });
    await tick();
    vi.resetModules();
    const tabB = await import("../push-activation.client");
    const disabling = tabB.deactivatePush("reader");
    const enabling = tabA.activatePush("reader");
    pause.resolve();
    const [repaired, , enabled] = await Promise.all([
      repairing,
      disabling,
      enabling,
    ]);
    expect(repaired).toBe(false);
    expect(enabled).toBe(true);
    expect(browser.subscribed).toBe(true);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new-token");
  });

  it("cancels an activation queued before account deletion", async () => {
    const queue = await import("../push-work-queue.client");
    const pause = deferred();
    const blocker = queue.queuePushWork(() => pause.promise);
    const { activatePush } = await import("../push-activation.client");
    const activation = activatePush("deleted-reader", {
      readerInitiated: false,
    });
    const { dropBrowserPushSubscriptionOnAccountDeletion } = await import(
      "../release-push-device.client"
    );
    await dropBrowserPushSubscriptionOnAccountDeletion();
    pause.resolve();
    const [, activated] = await Promise.all([blocker, activation]);
    expect(activated).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(browser.subscribed).toBe(false);
  });

  it.each(["delete", "sign out"])(
    "cancels repair when another tab ends the session: %s",
    async (action) => {
      const { activatePush } = await import("../push-activation.client");
      const pause = deferred();
      activate.mockImplementationOnce(async () => {
        await pause.promise;
        browser.subscribed = true;
        localStorage.setItem(TOKEN_KEY, "late-token");
      });
      const activation = activatePush("deleted-reader", {
        readerInitiated: false,
      });
      await tick();
      vi.resetModules();
      const { dropBrowserPushSubscriptionOnAccountDeletion } = await import(
        "../release-push-device.client"
      );
      if (action === "delete") {
        await dropBrowserPushSubscriptionOnAccountDeletion();
      } else {
        const { releasePushDeviceOnSignOut } = await import(
          "../release-push-device.client"
        );
        await releasePushDeviceOnSignOut("deleted-reader");
      }
      pause.resolve();
      await expect(activation).resolves.toBe(false);
      expect(browser.subscribed).toBe(false);
      expect(subscribeDevice).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "keeps late teardown ahead of activation after the deadline (other tab: %s)",
    async (otherTab) => {
      vi.useFakeTimers();
      browser.subscribed = true;
      const pause = deferred();
      unsubscribeDevice.mockImplementationOnce(() => pause.promise);
      const { activatePush, deactivatePush } = await import(
        "../push-activation.client"
      );
      const disabling = expect(deactivatePush("reader")).rejects.toThrow(
        "The Ably push teardown did not answer",
      );
      await vi.advanceTimersByTimeAsync(40_000);
      await disabling;
      if (otherTab) {
        vi.resetModules();
      }
      const nextTab = otherTab
        ? await import("../push-activation.client")
        : { activatePush };
      const enabling = nextTab.activatePush("reader");
      await vi.advanceTimersByTimeAsync(0);
      const activatedBeforeOldTeardown = activate.mock.calls.length;
      pause.resolve();
      await enabling;
      expect(activatedBeforeOldTeardown).toBe(0);
      expect(browser.subscribed).toBe(true);
      expect(localStorage.getItem(TOKEN_KEY)).toBe("new-token");
    },
  );
});
