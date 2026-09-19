import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isPushSupportedMock,
  hasWebPushSubscriptionMock,
  getBrowserNotificationPermissionMock,
  hasAblyPushRegistrationMock,
  hasUnfinishedPushTeardownMock,
} = vi.hoisted(() => ({
  isPushSupportedMock: vi.fn(),
  hasWebPushSubscriptionMock: vi.fn(),
  getBrowserNotificationPermissionMock: vi.fn(),
  hasAblyPushRegistrationMock: vi.fn(),
  hasUnfinishedPushTeardownMock: vi.fn(),
}));

vi.mock("@/lib/utils/notification-service-worker", () => ({
  isPushSupported: () => isPushSupportedMock(),
  hasWebPushSubscription: () => hasWebPushSubscriptionMock(),
}));

vi.mock("@/lib/utils/browser-notification", () => ({
  getBrowserNotificationPermission: () =>
    getBrowserNotificationPermissionMock(),
}));

vi.mock("./release-push-device.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./release-push-device.client")>()),
  hasAblyPushRegistration: () => hasAblyPushRegistrationMock(),
  hasUnfinishedPushTeardown: () => hasUnfinishedPushTeardownMock(),
}));

/**
 * The outcome is module state, so every test loads its own copy. A shared one
 * would carry the previous test's answer into the next one's first read, and
 * `pending` is exactly the value those tests are about.
 */
async function loadStore() {
  vi.resetModules();
  return import("./push-repair-outcome.client");
}

/** A browser that was set up for push and has since lost its subscription. */
function quietBrowser() {
  isPushSupportedMock.mockReturnValue(true);
  getBrowserNotificationPermissionMock.mockReturnValue("granted");
  hasAblyPushRegistrationMock.mockReturnValue(true);
  hasUnfinishedPushTeardownMock.mockReturnValue(false);
  hasWebPushSubscriptionMock.mockResolvedValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  quietBrowser();
});

describe("push repair outcome", () => {
  it("starts pending, so nothing reports on a browser no repair has read", async () => {
    const store = await loadStore();

    expect(store.getPushRepairOutcome()).toBe("pending");
  });

  it("reports a browser that lost its subscription as quiet", async () => {
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("quiet");
  });

  it("reports a repaired browser as healthy", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  /**
   * No registration means this browser never turned push on, or turned it
   * off. Telling that reader their push stopped would be a notice about a
   * thing they never asked for.
   */
  it("leaves a browser that never turned push on alone", async () => {
    hasAblyPushRegistrationMock.mockReturnValue(false);
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  /** A sign-out takes the subscription with it. That is not a fault. */
  it("says nothing while a sign-out teardown is unfinished", async () => {
    hasUnfinishedPushTeardownMock.mockReturnValue(true);
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  it("says nothing on a browser without the push API", async () => {
    isPushSupportedMock.mockReturnValue(false);
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  /** A revoked permission is its own message, and the card already has one. */
  it("says nothing when the permission is not granted", async () => {
    getBrowserNotificationPermissionMock.mockReturnValue("denied");
    const store = await loadStore();

    await store.recordPushRepairOutcome();

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  /**
   * The repair destroys its own evidence. `activatePush` clears Ably's stored
   * state halfway through its round, so a repair that fails after that point
   * leaves no registration behind. Read again afterwards, the one browser
   * this notice exists for looks like one that never turned push on.
   */
  it("still reports quiet when the repair took the registration with it", async () => {
    hasAblyPushRegistrationMock.mockReturnValue(false);
    const store = await loadStore();

    await store.recordPushRepairOutcome({ hadRegistration: true });

    expect(store.getPushRepairOutcome()).toBe("quiet");
  });

  /** The caller's read does not override a browser that is fine now. */
  it("reports healthy when a repair that held a registration worked", async () => {
    hasAblyPushRegistrationMock.mockReturnValue(false);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    const store = await loadStore();

    await store.recordPushRepairOutcome({ hadRegistration: true });

    expect(store.getPushRepairOutcome()).toBe("healthy");
  });

  it("tells subscribers when the answer changes, and only then", async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribePushRepairOutcome(listener);

    await store.recordPushRepairOutcome();
    expect(listener).toHaveBeenCalledTimes(1);

    // The same answer twice is not news, and a view that re-rendered on it
    // would re-render on every repair that changed nothing.
    await store.recordPushRepairOutcome();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    await store.recordPushRepairOutcome();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getPushRepairOutcome()).toBe("healthy");
  });
});

it("keeps an unresolved repair notice after reload", async () => {
  hasAblyPushRegistrationMock.mockReturnValue(false);
  const firstPage = await loadStore();
  await firstPage.recordPushRepairOutcome({ hadRegistration: true });
  expect(firstPage.getPushRepairOutcome()).toBe("quiet");
  const nextPage = await loadStore();
  await nextPage.recordPushRepairOutcome();
  expect(nextPage.getPushRepairOutcome()).toBe("quiet");
});

it("forgets a resolved repair after reload", async () => {
  hasAblyPushRegistrationMock.mockReturnValue(false);
  const store = await loadStore();
  await store.recordPushRepairOutcome({ hadRegistration: true });
  hasWebPushSubscriptionMock.mockResolvedValue(true);
  await store.recordPushRepairOutcome();
  expect(store.getPushRepairOutcome()).toBe("healthy");
  hasWebPushSubscriptionMock.mockResolvedValue(false);
  const nextPage = await loadStore();
  await nextPage.recordPushRepairOutcome();
  expect(nextPage.getPushRepairOutcome()).toBe("healthy");
});

it.each(["disable", "sign out", "delete account"])(
  "forgets unresolved repair after %s",
  async (action) => {
    hasAblyPushRegistrationMock.mockReturnValue(false);
    const store = await loadStore();
    await store.recordPushRepairOutcome({ hadRegistration: true });
    const release = await import("./release-push-device.client");
    expect(release.hasUnresolvedPushRepair()).toBe(true);

    if (action === "disable") {
      release.notePushTeardownStarted();
    } else if (action === "sign out") {
      await release.releasePushDeviceOnSignOut("user_alice");
    } else {
      await release.dropBrowserPushSubscriptionOnAccountDeletion();
    }
    expect(release.hasUnresolvedPushRepair()).toBe(false);
    const nextPage = await loadStore();
    await nextPage.recordPushRepairOutcome();
    expect(nextPage.getPushRepairOutcome()).toBe("healthy");
  },
);

it("does not persist a repair overtaken by teardown during the subscription read", async () => {
  const store = await loadStore();
  const { notePushTeardown } = await import("./push-work-queue.client");
  let finishRead = (_subscribed: boolean) => {};
  hasWebPushSubscriptionMock.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishRead = resolve;
      }),
  );
  const recording = store.recordPushRepairOutcome({ hadRegistration: true });
  notePushTeardown();
  finishRead(false);
  await recording;
  const { hasUnresolvedPushRepair } = await import(
    "./release-push-device.client"
  );
  expect(hasUnresolvedPushRepair()).toBe(false);
});

it("does not persist a repair that settled after teardown", async () => {
  const store = await loadStore();
  const { getPushTeardownVersion, notePushTeardown } = await import(
    "./push-work-queue.client"
  );
  const teardownVersion = getPushTeardownVersion();
  notePushTeardown();
  await store.recordPushRepairOutcome({
    hadRegistration: true,
    teardownVersion,
  });
  const { hasUnresolvedPushRepair } = await import(
    "./release-push-device.client"
  );
  expect(hasUnresolvedPushRepair()).toBe(false);
});
