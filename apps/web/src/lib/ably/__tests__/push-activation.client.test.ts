import { beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribeDeviceMock = vi.fn();
const subscribeDeviceMock = vi.fn();
const activateMock = vi.fn();
const deactivateMock = vi.fn();
const unsubscribeMock = vi.fn();
const getSubscriptionMock = vi.fn();
const getNotificationServiceWorkerMock = vi.fn();

const calls: string[] = [];

vi.mock("../realtime-singleton.client", () => ({
  getAblyRealtimeClient: () => ({
    push: {
      activate: () => {
        calls.push("activate");
        return activateMock();
      },
      deactivate: () => {
        calls.push("deactivate");
        return deactivateMock();
      },
    },
    channels: {
      get: () => ({
        push: {
          subscribeDevice: () => {
            calls.push("subscribeDevice");
            return subscribeDeviceMock();
          },
          unsubscribeDevice: () => {
            calls.push("unsubscribeDevice");
            return unsubscribeDeviceMock();
          },
        },
      }),
    },
  }),
}));

const hasWebPushSubscriptionMock = vi.fn();

vi.mock("@/lib/utils/notification-service-worker", () => ({
  getExistingNotificationServiceWorker: () =>
    getNotificationServiceWorkerMock(),
  hasWebPushSubscription: () => hasWebPushSubscriptionMock(),
}));

import { activatePush, deactivatePush } from "../push-activation.client";

describe("deactivatePush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    activateMock.mockResolvedValue(undefined);
    subscribeDeviceMock.mockResolvedValue(undefined);
    unsubscribeDeviceMock.mockResolvedValue(undefined);
    deactivateMock.mockResolvedValue(undefined);
    unsubscribeMock.mockResolvedValue(true);
    getSubscriptionMock.mockResolvedValue({ unsubscribe: unsubscribeMock });
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    getNotificationServiceWorkerMock.mockResolvedValue({
      pushManager: { getSubscription: getSubscriptionMock },
    });
  });

  /**
   * Ably's `deactivate()` leaves the browser subscription alive, and the
   * settings switch reads that subscription. Leaving it would show the switch
   * on for a device that receives nothing.
   */
  it("drops the browser subscription as well as the Ably device", async () => {
    await deactivatePush("user_1");

    expect(unsubscribeDeviceMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("finishes when this browser holds no subscription", async () => {
    getSubscriptionMock.mockResolvedValue(null);

    await expect(deactivatePush("user_1")).resolves.toBeUndefined();
    expect(deactivateMock).toHaveBeenCalledTimes(1);
  });

  it("finishes when this browser has no worker to read", async () => {
    getNotificationServiceWorkerMock.mockResolvedValue(null);

    await expect(deactivatePush("user_1")).resolves.toBeUndefined();
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it("drops the channel subscription before the device", async () => {
    await deactivatePush("user_1");

    expect(calls).toEqual(["unsubscribeDevice", "deactivate"]);
  });

  it("stops when Ably refuses the deactivation", async () => {
    deactivateMock.mockRejectedValue(new Error("offline"));

    await expect(deactivatePush("user_1")).rejects.toThrow("offline");
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });
});

describe("activatePush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    activateMock.mockResolvedValue(undefined);
    subscribeDeviceMock.mockResolvedValue(undefined);
    deactivateMock.mockResolvedValue(undefined);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
  });

  /**
   * `subscribeDevice` needs the device identity token that `activate()`
   * stores, so the order is a contract, not a preference.
   */
  it("registers the device before binding it to the channel", async () => {
    await activatePush("user_1");

    expect(calls).toEqual(["activate", "subscribeDevice"]);
  });

  it("does not bind the channel when activation fails", async () => {
    activateMock.mockRejectedValue(new Error("denied"));

    await expect(activatePush("user_1")).rejects.toThrow("denied");
    expect(subscribeDeviceMock).not.toHaveBeenCalled();
  });

  /**
   * Ably skips the subscribe when its own stored state already calls this
   * browser activated, so a browser whose subscription was cleared underneath
   * it would report success and receive nothing.
   */
  it("clears the stored activation and retries when no subscription appears", async () => {
    hasWebPushSubscriptionMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await activatePush("user_1");

    expect(calls).toEqual([
      "activate",
      "subscribeDevice",
      "deactivate",
      "activate",
      "subscribeDevice",
    ]);
  });

  it("fails rather than reporting success with no subscription", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);

    await expect(activatePush("user_1")).rejects.toThrow(
      "The browser created no push subscription",
    );
  });

  it("does not clear the stored activation when the browser subscribed", async () => {
    await activatePush("user_1");

    expect(deactivateMock).not.toHaveBeenCalled();
  });
});
