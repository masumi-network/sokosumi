import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribeDeviceMock = vi.fn();
const subscribeDeviceMock = vi.fn();
const activateMock = vi.fn();
const deactivateMock = vi.fn();
const unsubscribeMock = vi.fn();
const getSubscriptionMock = vi.fn();
const getNotificationServiceWorkerMock = vi.fn();

const calls: string[] = [];

vi.mock("./realtime-singleton.client", () => ({
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

import { activatePush, deactivatePush } from "./push-activation.client";

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

  /**
   * The Ably calls can throw, and the sign-out path swallows that so the
   * reader can still leave. The browser endpoint is the only step that stops
   * delivery here, so it has to be gone before Ably gets its chance to fail.
   */
  it("drops the browser subscription even when ably fails", async () => {
    unsubscribeDeviceMock.mockRejectedValue(new Error("ably said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow("ably said no");
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

  /**
   * This assertion used to read `not.toHaveBeenCalled()`, which locked in the
   * defect: the rejection reaches a sign-out that swallows it, so leaving the
   * browser endpoint live let the previous reader's banners carry on.
   */
  it("has already dropped the browser subscription when Ably refuses", async () => {
    deactivateMock.mockRejectedValue(new Error("offline"));

    await expect(deactivatePush("user_1")).rejects.toThrow("offline");
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});

describe("activatePush", () => {
  let browserRequestPermission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    activateMock.mockResolvedValue(undefined);
    subscribeDeviceMock.mockResolvedValue(undefined);
    deactivateMock.mockResolvedValue(undefined);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    browserRequestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: browserRequestPermission,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  /**
   * `ably@2.28.0` asks for the permission a second time inside `activate()`,
   * by then outside the user gesture, and WebKit answers `denied` to that.
   * The caller has already asked, so the SDK reads the stored permission.
   *
   * Both assertions matter together: without the swap the "restored" check
   * passes on its own, because nothing ever replaced the browser's own call.
   */
  it("answers Ably's permission request itself, then restores the browser's", async () => {
    let answered: string | undefined;
    let duringActivation: unknown;
    activateMock.mockImplementation(async () => {
      duringActivation = Notification.requestPermission;
      answered = await Notification.requestPermission();
    });

    await activatePush("user_1");

    expect(duringActivation).not.toBe(browserRequestPermission);
    expect(answered).toBe("granted");
    expect(browserRequestPermission).not.toHaveBeenCalled();
    expect(Notification.requestPermission).toBe(browserRequestPermission);
  });

  /**
   * A reader can work the account switch and the device switch inside one
   * page, so two activations can overlap. Saving the previous value per call
   * would have the second call save the first call's stand-in as if it were
   * the browser's own, and the last release would install that stand-in for
   * good: the page could then never prompt again.
   */
  it("restores the browser's own request after overlapping activations", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = activatePush("user_1");
    const second = activatePush("user_1");
    expect(resolvers).toHaveLength(2);

    resolvers[0]();
    await first;
    // The second activation is still running, so Ably must still not prompt.
    expect(Notification.requestPermission).not.toBe(browserRequestPermission);

    resolvers[1]();
    await second;
    expect(Notification.requestPermission).toBe(browserRequestPermission);
  });

  it("restores the browser's permission request when activation fails", async () => {
    let duringActivation: unknown;
    activateMock.mockImplementation(async () => {
      duringActivation = Notification.requestPermission;
      throw new Error("denied");
    });

    await expect(activatePush("user_1")).rejects.toThrow("denied");
    expect(duringActivation).not.toBe(browserRequestPermission);
    expect(Notification.requestPermission).toBe(browserRequestPermission);
  });
});
