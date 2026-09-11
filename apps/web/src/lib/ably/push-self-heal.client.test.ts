import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isPushSupportedMock,
  hasWebPushSubscriptionMock,
  getBrowserNotificationPermissionMock,
  hasAblyPushRegistrationMock,
  activatePushMock,
  countPushTeardownsMock,
  hasUnfinishedPushTeardownMock,
} = vi.hoisted(() => ({
  isPushSupportedMock: vi.fn(),
  hasWebPushSubscriptionMock: vi.fn(),
  getBrowserNotificationPermissionMock: vi.fn(),
  hasAblyPushRegistrationMock: vi.fn(),
  activatePushMock: vi.fn(),
  countPushTeardownsMock: vi.fn(),
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

vi.mock("./release-push-device.client", () => ({
  hasAblyPushRegistration: () => hasAblyPushRegistrationMock(),
  hasUnfinishedPushTeardown: () => hasUnfinishedPushTeardownMock(),
}));

vi.mock("./push-work-queue.client", () => ({
  countPushTeardowns: () => countPushTeardownsMock(),
}));

vi.mock("./push-activation.client", () => ({
  activatePush: (...args: unknown[]) => activatePushMock(...args),
}));

import { healPushSubscription } from "./push-self-heal.client";

const USER_ID = "user_alice";

/** A browser that was set up for push and has since lost its subscription. */
function repairable() {
  isPushSupportedMock.mockReturnValue(true);
  getBrowserNotificationPermissionMock.mockReturnValue("granted");
  hasAblyPushRegistrationMock.mockReturnValue(true);
  hasWebPushSubscriptionMock.mockResolvedValue(false);
  countPushTeardownsMock.mockReturnValue(0);
  hasUnfinishedPushTeardownMock.mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  repairable();
  activatePushMock.mockResolvedValue(undefined);
});

describe("healPushSubscription", () => {
  it("re-subscribes a browser that lost its subscription", async () => {
    await expect(healPushSubscription(USER_ID)).resolves.toBe(true);
    expect(activatePushMock).toHaveBeenCalledWith(USER_ID);
  });

  /** No registration means this browser never turned push on, or turned it
   * off. Either way it is not asking to be subscribed. */
  it("leaves a browser with no Ably registration alone", async () => {
    hasAblyPushRegistrationMock.mockReturnValue(false);

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);
    expect(activatePushMock).not.toHaveBeenCalled();
  });

  /** Asking for the permission is a decision the reader makes on a page they
   * went to, never a prompt on app open. */
  it("never asks for a permission the reader has not granted", async () => {
    getBrowserNotificationPermissionMock.mockReturnValue("default");

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);
    expect(activatePushMock).not.toHaveBeenCalled();
  });

  it("leaves a browser that is still subscribed alone", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);
    expect(activatePushMock).not.toHaveBeenCalled();
  });

  it("does nothing where the browser cannot push at all", async () => {
    isPushSupportedMock.mockReturnValue(false);

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);
    expect(activatePushMock).not.toHaveBeenCalled();
  });

  /** The reader asked for nothing, so a failure leaves them where they were
   * rather than reaching them as an error. */
  it("reports false instead of throwing when the repair fails", async () => {
    activatePushMock.mockRejectedValue(new Error("activation failed"));

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);
  });
});

describe("healPushSubscription during a sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The repair decides to act, then waits on a chunk of the Ably SDK. Nothing
   * is queued yet, so a sign-out inside that wait finds nothing of this run to
   * order itself against: it tears the browser down and leaves, and the repair
   * would then subscribe the browser the reader just signed out of.
   */
  it("gives up on a browser that was torn down while it loaded", async () => {
    repairable();
    countPushTeardownsMock.mockReturnValueOnce(0).mockReturnValueOnce(1);

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);

    expect(activatePushMock).not.toHaveBeenCalled();
  });

  it("repairs when nothing was turned off while it loaded", async () => {
    repairable();

    await expect(healPushSubscription(USER_ID)).resolves.toBe(true);

    expect(activatePushMock).toHaveBeenCalledWith(USER_ID);
  });
});

describe("healPushSubscription after an interrupted teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Turning push off is several steps, and a reload in the middle of them
   * leaves the token beside a browser with no subscription: the shape this
   * repair reads as a subscription that died by itself. The page that ran the
   * teardown is gone, so nothing in memory says what happened.
   */
  it("leaves a browser whose teardown was never seen through", async () => {
    repairable();
    hasUnfinishedPushTeardownMock.mockReturnValue(true);

    await expect(healPushSubscription(USER_ID)).resolves.toBe(false);

    expect(activatePushMock).not.toHaveBeenCalled();
  });
});
