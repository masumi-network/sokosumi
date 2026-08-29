import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribeDeviceMock = vi.fn();
const subscribeDeviceMock = vi.fn();
const activateMock = vi.fn();
const deactivateMock = vi.fn();
const unsubscribeMock = vi.fn();
const getSubscriptionMock = vi.fn();
const getNotificationServiceWorkerMock = vi.fn();

const calls: string[] = [];

/** Set to make the singleton throw the way a first construction can. */
let clientConstructionError: Error | null = null;

vi.mock("./realtime-singleton.client", () => ({
  getAblyRealtimeClient: () => {
    if (clientConstructionError) {
      throw clientConstructionError;
    }
    return {
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
    };
  },
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
    clientConstructionError = null;
    activateMock.mockResolvedValue(undefined);
    subscribeDeviceMock.mockResolvedValue(undefined);
    unsubscribeDeviceMock.mockResolvedValue(undefined);
    deactivateMock.mockResolvedValue(undefined);
    unsubscribeMock.mockResolvedValue(true);
    getSubscriptionMock.mockResolvedValue({
      unsubscribe: () => {
        calls.push("unsubscribeBrowser");
        return unsubscribeMock();
      },
    });
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    getNotificationServiceWorkerMock.mockResolvedValue({
      pushManager: { getSubscription: getSubscriptionMock },
    });
  });

  afterEach(() => {
    // One test spies on the console. A failed assertion would leave that spy
    // in place and swallow every later report in this file.
    vi.restoreAllMocks();
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
   * reader can still leave. The browser endpoint must still be gone. Order is
   * not what this pins; the test below it does that.
   */
  it("drops the browser subscription even when ably fails", async () => {
    unsubscribeDeviceMock.mockRejectedValue(new Error("ably said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow("ably said no");
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  /**
   * `deactivate()` is what clears the identity token the next sign-out reads.
   * Letting a failed channel unsubscribe skip it would leave the token behind,
   * and every later sign-out would build a client and mint a token to fail the
   * same way again.
   */
  it("deactivates the device even when the channel unsubscribe fails", async () => {
    unsubscribeDeviceMock.mockRejectedValue(new Error("ably said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow("ably said no");
    expect(deactivateMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A push service can refuse the browser unsubscribe. Ably's own teardown
   * must still happen, or the device keeps its channel subscription and the
   * reader keeps receiving.
   */
  it("still tears Ably down when the browser unsubscribe fails", async () => {
    unsubscribeMock.mockRejectedValue(new Error("push service said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow(
      "push service said no",
    );
    expect(unsubscribeDeviceMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).toHaveBeenCalledTimes(1);
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

  /**
   * The browser endpoint leads, because it is the only step that stops
   * delivery here and the two Ably calls can fail. `attempt` removed the
   * short-circuit that used to imply this, so the order is asserted directly.
   */
  it("drops the browser endpoint, then the channel, then the device", async () => {
    await deactivatePush("user_1");

    expect(calls).toEqual([
      "unsubscribeBrowser",
      "unsubscribeDevice",
      "deactivate",
    ]);
  });

  /**
   * `getAblyRealtimeClient` builds the client on its first call and can throw
   * there. Reading it before the browser endpoint went would skip the one step
   * that stops delivery, which is the whole reason that step leads.
   */
  it("drops the browser endpoint even when the Ably client cannot be built", async () => {
    clientConstructionError = new Error("no realtime client");

    await expect(deactivatePush("user_1")).rejects.toThrow(
      "no realtime client",
    );
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Both halves failing must still report the first one. Building the client
   * outside `attempt` used to discard the browser failure and report only its
   * own, which is the failure the caller can do least about.
   */
  it("reports the browser failure when the client also cannot be built", async () => {
    unsubscribeMock.mockRejectedValue(new Error("push service said no"));
    clientConstructionError = new Error("no realtime client");

    await expect(deactivatePush("user_1")).rejects.toThrow(
      "push service said no",
    );
  });

  /**
   * One failed step is one failed step. `dropAblyPushDevice` used to keep its
   * own list and rethrow, so the caller's `attempt` logged the same rejection
   * again and triage read two failures where there was one.
   */
  it("logs a failed Ably step once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("ably said no");
    deactivateMock.mockRejectedValue(reason);

    await expect(deactivatePush("user_1")).rejects.toThrow("ably said no");

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith("A push teardown step failed", reason);
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
    clientConstructionError = null;
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
