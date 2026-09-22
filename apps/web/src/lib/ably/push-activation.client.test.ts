import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unsubscribeDeviceMock = vi.fn();
const subscribeDeviceMock = vi.fn();
const activateMock = vi.fn();
const deactivateMock = vi.fn();
const unsubscribeMock = vi.fn();
const getSubscriptionMock = vi.fn();
const getNotificationServiceWorkerMock = vi.fn();
const getChannelMock = vi.fn();

const envMock = {
  NEXT_PUBLIC_NETWORK: "Mainnet" as const,
  NEXT_PUBLIC_VERCEL_ENV: "production" as "production" | "preview",
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
};

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => envMock,
}));

const needsResetMock = vi.fn();
const getDeviceMock = vi.fn();
vi.mock("./push-device-health.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./push-device-health.client")>()),
  findPushDeviceFault: async () => {
    const answer: unknown = await needsResetMock();
    // A string is the fault itself, so a test can arm two different ones and
    // tell which read reported which.
    if (typeof answer === "string") return answer;
    return answer ? "delivery-failed" : null;
  },
}));
const recordOutcomeMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("./push-repair-outcome.client", () => ({
  recordPushRepairOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
}));
const rememberRenewalMock = vi.fn();
const revokeRenewalMock = vi.fn();
vi.mock("./push-renewal.client", () => ({
  rememberPushRenewal: (...args: unknown[]) => rememberRenewalMock(...args),
  revokePushRenewal: (...args: unknown[]) => revokeRenewalMock(...args),
}));
beforeEach(() => {
  rememberRenewalMock.mockReset().mockResolvedValue(undefined);
  revokeRenewalMock.mockReset().mockResolvedValue(undefined);
});
const calls: string[] = [];

/** Set to make the singleton throw the way a first construction can. */
let clientConstructionError: Error | null = null;

vi.mock("./push-client.client", () => ({
  createAblyPushClient: () => {
    if (clientConstructionError) {
      throw clientConstructionError;
    }
    return {
      getDevice: () => getDeviceMock(),
      push: {
        activate: () => {
          calls.push("activate");
          return activateMock();
        },
        deactivate: (...args: unknown[]) => {
          calls.push("deactivate");
          return deactivateMock(...args);
        },
      },
      channels: {
        get: (...args: unknown[]) => {
          getChannelMock(...args);
          return {
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
          };
        },
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
import { notePushTeardown, queuePushWork } from "./push-work-queue.client";

describe("deactivatePush", () => {
  let browserSubscribed = true;

  beforeEach(() => {
    vi.clearAllMocks();
    needsResetMock.mockReset().mockResolvedValue(false);
    getDeviceMock.mockResolvedValue({ deviceIdentityToken: "token" });
    calls.length = 0;
    clientConstructionError = null;
    activateMock.mockResolvedValue(undefined);
    subscribeDeviceMock.mockResolvedValue(undefined);
    unsubscribeDeviceMock.mockResolvedValue(undefined);
    deactivateMock.mockResolvedValue(undefined);
    // The browser, not a constant: a subscription that unsubscribes is gone
    // afterwards, and the teardown reads it back to decide whether this
    // browser still has one. A test that said "subscribed" whatever happened
    // would answer that read with a browser no browser behaves like.
    browserSubscribed = true;
    unsubscribeMock.mockImplementation(async () => {
      browserSubscribed = false;

      return true;
    });
    getSubscriptionMock.mockResolvedValue({
      unsubscribe: () => {
        calls.push("unsubscribeBrowser");
        return unsubscribeMock();
      },
    });
    hasWebPushSubscriptionMock.mockImplementation(
      async () => browserSubscribed,
    );
    envMock.NEXT_PUBLIC_VERCEL_ENV = "production";
    envMock.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "main";
    getNotificationServiceWorkerMock.mockResolvedValue({
      pushManager: { getSubscription: getSubscriptionMock },
    });
  });

  afterEach(() => {
    // One test spies on the console. A failed assertion would leave that spy
    // in place and swallow every later report in this file. Same for the fake
    // timers one test installs.
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Ably's `deactivate()` leaves the browser subscription alive, and the
   * settings switch reads that subscription. Leaving it would show the switch
   * on for a device that receives nothing.
   */
  it("resets missing credentials on teardown without waiting for SDK authentication", async () => {
    getDeviceMock.mockResolvedValue({ id: "old-device" });
    await deactivatePush("user_1");
    expect(deactivateMock).toHaveBeenLastCalledWith(expect.any(Function));
  });

  it("revokes worker authority before deactivating the device", async () => {
    let finish = () => {};
    revokeRenewalMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const work = deactivatePush("user_1");
    expect(revokeRenewalMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).not.toHaveBeenCalled();
    finish();
    await work;
    expect(deactivateMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The name outlives the teardown, because what it names does. A release
   * drops the identity token and leaves the device id, and a release the cap
   * cuts short leaves the record on Ably with this reader's channel still
   * bound to it. Forgetting the name there would hand the next reader an
   * unclaimed device and bind them beside this reader.
   */
  it("keeps the name of the reader the device was registered for", async () => {
    localStorage.setItem("sokosumi.push.deviceOwner", "user_1");

    await deactivatePush("user_1");

    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

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
   * `deactivate()` clears the identity token only when it lands. A disable
   * that failed halfway leaves the token beside a browser with no
   * subscription, which is what the repair on open looks for, so the reader
   * would find push back on. Saying it locally cannot fail on the network.
   */
  it("forgets the registration even when the deactivation fails", async () => {
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    deactivateMock.mockRejectedValue(new Error("ably said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow("ably said no");
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  /**
   * A rejection is recorded and the token still goes. A hang is not a
   * rejection: `deactivate()` is two REST calls with the SDK's own retry
   * budget and can outlive the page, and the token left behind is exactly what
   * the repair on open reads as an invitation. A reader who deliberately
   * turned push off would find it back on.
   */
  it("forgets the registration when the deactivation never answers", async () => {
    vi.useFakeTimers();
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    let finishTeardown = () => {};
    deactivateMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishTeardown = resolve;
      }),
    );

    const teardown = deactivatePush("user_1");
    const settled = expect(teardown).rejects.toThrow(
      "The Ably push teardown did not answer",
    );
    await vi.advanceTimersByTimeAsync(40_000);
    await settled;
    const forgottenAtDeadline = localStorage.getItem(
      "ably.push.deviceIdentityToken",
    );
    finishTeardown();
    await queuePushWork(async () => {});

    expect(forgottenAtDeadline).toBeNull();
  });

  /**
   * The steps of a teardown can be cut short by a reload or a closed tab, and
   * what they leave then is a token beside a browser with no subscription:
   * the shape the repair on open reads as a subscription that died by itself.
   * The note outlives the page, so the repair can tell the two apart.
   */
  it("leaves a note behind for a teardown that was not seen through", async () => {
    unsubscribeMock.mockRejectedValue(new Error("push service said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow(
      "push service said no",
    );

    expect(
      localStorage.getItem("sokosumi.push.teardownStarted"),
    ).not.toBeNull();
  });

  it("takes the note back once the teardown is seen through", async () => {
    await deactivatePush("user_1");

    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBeNull();
  });

  /**
   * A browser whose endpoint is still live is still being delivered to, and
   * the token is what a later sign-out needs to deregister it. The repair
   * reads the subscription too, so it leaves such a browser alone anyway.
   */
  it("keeps the registration when the browser subscription survived", async () => {
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    unsubscribeMock.mockRejectedValue(new Error("push service said no"));

    await expect(deactivatePush("user_1")).rejects.toThrow(
      "push service said no",
    );
    expect(
      localStorage.getItem("ably.push.deviceIdentityToken"),
    ).not.toBeNull();
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
    needsResetMock.mockReset().mockResolvedValue(false);
    getDeviceMock.mockResolvedValue({ deviceIdentityToken: "token" });
    localStorage.clear();
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
    localStorage.clear();
  });

  /**
   * A note that a teardown was cut short reads as push off, and turning push
   * on is the reader saying the opposite. Left there, the repair would decline
   * to bring this browser back for the rest of its life.
   */
  it("answers a teardown this browser was left in the middle of", async () => {
    localStorage.setItem("sokosumi.push.teardownStarted", "1");

    await activatePush("user_1");

    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBeNull();
  });

  /**
   * A repair is not the reader asking for push on. Clearing the note would
   * answer a teardown another tab started, and then subscribe over it.
   */
  it("leaves an unfinished teardown in place when the reader did not ask", async () => {
    localStorage.setItem("sokosumi.push.teardownStarted", "1");

    await activatePush("user_1", { readerInitiated: false });

    expect(activateMock).not.toHaveBeenCalled();
    expect(subscribeDeviceMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBe("1");
  });

  /**
   * The first round already ran, and the retry is the widest window a
   * teardown in another tab can land in. Subscribing then would turn push
   * back on for a reader who asked it off.
   */
  it("stops a repair before the second subscribe when a teardown starts between rounds", async () => {
    needsResetMock.mockResolvedValueOnce(true);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    deactivateMock.mockImplementation(async () => {
      localStorage.setItem("sokosumi.push.teardownStarted", "1");
    });

    await activatePush("user_1", { readerInitiated: false });

    expect(calls).toEqual(["activate", "unsubscribeBrowser", "deactivate"]);
    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBe("1");
  });

  /**
   * SOK-1152: a browser two readers share. An expired session releases
   * nothing, so the previous reader's registration is still here, and joining
   * it would bind this reader's channel beside theirs on one device.
   */
  it("replaces a registration this browser holds for another reader", async () => {
    localStorage.setItem("ably.push.deviceId", "their-device");
    localStorage.setItem("sokosumi.push.deviceOwner", "user_2");
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    await expect(activatePush("user_1")).resolves.toBe(true);

    expect(calls).toEqual([
      "activate",
      "unsubscribeBrowser",
      "deactivate",
      "activate",
      "subscribeDevice",
    ]);
    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * The name has to survive a run that registers and then fails, because the
   * device is already bound to this reader by then. Left naming the reader
   * this run took it from, their next activation would read a device of their
   * own and bind a second channel beside this one.
   */
  it("names the reader it bound the device to even when the run then fails", async () => {
    localStorage.setItem("ably.push.deviceId", "their-device");
    localStorage.setItem("sokosumi.push.deviceOwner", "user_2");
    hasWebPushSubscriptionMock.mockResolvedValue(false);

    await expect(activatePush("user_1")).rejects.toThrow(
      "The browser created no push subscription",
    );

    expect(calls).toContain("subscribeDevice");
    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * Every browser registered before the name was written down. Ably cannot
   * say who it belongs to, so the registration is replaced rather than
   * adopted, once, and named afterwards.
   */
  it("replaces a registration whose reader was never recorded", async () => {
    localStorage.setItem("ably.push.deviceId", "old-device");
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    await expect(activatePush("user_1")).resolves.toBe(true);

    expect(calls).toEqual([
      "activate",
      "unsubscribeBrowser",
      "deactivate",
      "activate",
      "subscribeDevice",
    ]);
    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * The cost of the two above must fall on a browser that held a
   * registration, and on no one else. A first activation registers nothing
   * beforehand, so it has no reader to take the device from.
   */
  it("names a browser that held no registration without replacing anything", async () => {
    await expect(activatePush("user_1")).resolves.toBe(true);

    expect(calls).toEqual(["activate", "subscribeDevice"]);
    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * The bind is the step that makes the device this reader's, so the name has
   * to be down before it, not merely before the checks that follow it. A bind
   * that reaches Ably and then rejects is the case that tells the two apart.
   */
  it("names the reader before binding, even when the bind then fails", async () => {
    localStorage.setItem("ably.push.deviceId", "their-device");
    localStorage.setItem("sokosumi.push.deviceOwner", "user_2");
    subscribeDeviceMock.mockRejectedValueOnce(new Error("ably said no"));

    await expect(activatePush("user_1")).rejects.toThrow("ably said no");

    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * The SDK mints a device id for a browser that never had one, so an
   * ownership answer read after that point would call every first activation
   * a device taken from someone else and reset it for nothing.
   */
  it("does not replace a device the run itself minted", async () => {
    activateMock.mockImplementation(async () => {
      localStorage.setItem("ably.push.deviceId", "fresh-device");
    });

    await expect(activatePush("user_1")).resolves.toBe(true);

    expect(calls).toEqual(["activate", "subscribeDevice"]);
    expect(localStorage.getItem("sokosumi.push.deviceOwner")).toBe("user_1");
  });

  /**
   * SOK-1152 was diagnosed from this message and nothing else. A registration
   * that stays broken through a reset is the one failure no retry clears, so
   * the message has to say which state held, and whether the reset changed it.
   */
  it("names both faults when a reset leaves the registration unhealthy", async () => {
    needsResetMock
      .mockReset()
      .mockResolvedValueOnce("endpoint-moved")
      .mockResolvedValue("another-reader");
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    await expect(activatePush("user_1")).rejects.toThrow(
      "The push device registration is still unhealthy: another-reader (was endpoint-moved)",
    );
  });

  /**
   * `subscribeDevice` needs the device identity token that `activate()`
   * stores, so the order is a contract, not a preference.
   */
  it("registers the device before binding it to the channel", async () => {
    await activatePush("user_1");

    expect(calls).toEqual(["activate", "subscribeDevice"]);
  });

  it("binds a preview device only to its branch channel", async () => {
    envMock.NEXT_PUBLIC_VERCEL_ENV = "preview";
    envMock.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "fix/push-urls";

    await activatePush("user_1");

    expect(getChannelMock).toHaveBeenCalledWith(
      "notifications:preview:mainnet:branch_fix%2Fpush-urls:user_user_1",
    );
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
    needsResetMock.mockResolvedValueOnce(true);
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    await activatePush("user_1");

    expect(calls).toEqual([
      "activate",
      "unsubscribeBrowser",
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
   * The round below deactivates the shared client halfway through, so a
   * second activation running beside the first would drop the device the
   * first had just registered.
   */
  it("runs one activation at a time", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = activatePush("user_1");
    const second = activatePush("user_1");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    resolvers[0]();
    await Promise.all([first, second]);
    expect(Notification.requestPermission).toBe(browserRequestPermission);
  });

  /**
   * Signing in again never reloads the page, so this module outlives the
   * reader it ran for. A second reader joining the first reader's activation
   * would be answered with the first reader's subscription.
   */
  it("does not answer a second reader with the first reader's activation", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = activatePush("user_1");
    const second = activatePush("user_2");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    resolvers[0]();
    await first;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]();
    await second;
    expect(subscribeDeviceMock).toHaveBeenCalledTimes(2);
  });

  /**
   * An account deletion cannot wait its turn in the queue, so it runs straight
   * through an activation rather than after it. `client.push.activate()` does
   * not notice: it registers on the Ably token the client already holds, good
   * for an hour after the Sokosumi session ended, and the SDK writes the
   * identity token back from its own state machine. So the activation lands
   * after the deletion has unsubscribed and forgotten the token, and would
   * leave the browser subscribed with the token back in storage, for an
   * account that no longer exists.
   */
  it("undoes itself when a teardown lands while it is away", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const activation = activatePush("user_1");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    // What an unqueued teardown does, in the order it does it.
    notePushTeardown();
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );

    resolvers[0]();
    await activation;

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
    expect(subscribeDeviceMock).not.toHaveBeenCalled();
  });

  /**
   * The undo is waited for rather than let go of. `dropBrowserPushSubscription`
   * reads the registration and the subscription when it runs, not when it is
   * called, so an undo left running settles whenever those reads settle: after
   * this run returns, after the queue advances, and possibly after a later
   * reader has pressed the Push cell and been subscribed. It would then read
   * that reader's subscription and take it. The activation is not finished
   * until its own undo is.
   */
  it("waits for the undo it started before it returns", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    // Held open, which is what a browser talking to its push service does.
    // Once, because this describe's `beforeEach` clears calls rather than
    // implementations, and an unsubscribe held open for the rest of the file
    // would hang every test after this one.
    let finishUnsubscribe: (() => void) | undefined;
    unsubscribeMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUnsubscribe = resolve;
        }),
    );

    let settled = false;
    const activation = activatePush("user_1").then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    notePushTeardown();
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    resolvers[0]();

    await vi.waitFor(() => expect(finishUnsubscribe).toBeDefined());
    // Given every chance to finish early, so this says the activation waited
    // rather than that it had not got round to resolving yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledWhileUndoRan = settled;

    // Released before anything is asserted. A failed assertion here would
    // otherwise leave this run holding the queue every later test waits on.
    finishUnsubscribe?.();
    await activation;

    expect(settledWhileUndoRan).toBe(false);
    expect(settled).toBe(true);
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  /**
   * The second round is the long one. A browser whose subscription was
   * cleared under Ably's stored state goes round again through
   * `client.push.deactivate()`, which is two REST calls this file caps at
   * forty seconds, so it is the widest window a teardown can land in. The
   * first round's check has already passed by then.
   */
  it("undoes itself when a teardown lands during the second round", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    // No subscription after the first round, which is what sends it round
    // again; one after the second, so nothing but the teardown ends this run.
    needsResetMock.mockResolvedValueOnce(true);
    hasWebPushSubscriptionMock.mockResolvedValue(true);

    const activation = activatePush("user_1");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]();
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // Lands while the second round is away, past the first round's check.
    notePushTeardown();
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );

    resolvers[1]();
    await activation;

    expect(unsubscribeMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  /**
   * The repair on open starts an activation nobody watched for, and a reader
   * can press Log out while it runs. Turning push off has to be the last word
   * on this browser, or the activation finishes afterwards and subscribes a
   * reader who has left.
   */
  it("turns push off after an activation that was already running", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const activation = activatePush("user_1");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    const teardown = deactivatePush("user_1");
    // A macrotask, so every microtask the teardown would run has had its turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unsubscribeMock).not.toHaveBeenCalled();

    resolvers[0]();
    await activation;
    await teardown;

    // Twice: the activation sees the teardown it was overtaken by and undoes
    // its own subscription, and the queued teardown then runs and unsubscribes
    // a browser that has none. The second is a no-op. The activation cannot
    // tell a queued teardown, which would have unsubscribed after it anyway,
    // from an account deletion, which ran straight through and unsubscribed
    // before this run made its subscription.
    expect(unsubscribeMock).toHaveBeenCalledTimes(2);
    expect(deactivateMock).toHaveBeenCalled();
  });

  /**
   * The teardown is queued behind a repair that has not finished, and the
   * reader turns push back on before either has run. Answering that press
   * with the repair would leave the cell reading on over a browser the
   * teardown then unsubscribes.
   */
  it("gives a reader turning push back on a run of their own", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const repair = activatePush("user_1");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    const teardown = deactivatePush("user_1");
    const pressedOn = activatePush("user_1");

    resolvers[0]();
    await repair;
    await teardown;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]();
    await pressedOn;

    // The last thing to happen is the subscribe the reader pressed for, not
    // the unsubscribe queued before it.
    expect(calls.lastIndexOf("subscribeDevice")).toBeGreaterThan(
      calls.lastIndexOf("unsubscribeBrowser"),
    );
  });

  /**
   * A second reader's activation is already waiting behind the first. Letting
   * the first clear the record would let a third call start a run beside
   * theirs, which is the overlap this exists to stop.
   */
  it("keeps a waiting reader on record when the one before finishes", async () => {
    const resolvers: Array<() => void> = [];
    activateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = activatePush("user_1");
    const second = activatePush("user_2");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    resolvers[0]();
    await first;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // The third call is the second reader again: it must find their run and
    // join it rather than start one beside it.
    const third = activatePush("user_2");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]();
    await Promise.all([second, third]);
    expect(subscribeDeviceMock).toHaveBeenCalledTimes(2);
  });

  /** A finished activation must not answer the next one. */
  it("does not report success when teardown starts during the final health record", async () => {
    recordOutcomeMock.mockImplementationOnce(async () => {
      notePushTeardown();
    });
    expect(await activatePush("user_1")).toBe(false);
  });

  it("keeps successful activation when the health observer throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordOutcomeMock.mockRejectedValueOnce(new Error("listener failed"));
    expect(await activatePush("user_1")).toBe(true);
    expect(subscribeDeviceMock).toHaveBeenCalled();
  });

  it("stores renewal authority only after device and channel registration succeed", async () => {
    expect(await activatePush("user_1")).toBe(true);
    expect(rememberRenewalMock).toHaveBeenCalledWith(
      expect.any(Object),
      "user_1",
      expect.any(String),
    );
    expect(rememberRenewalMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      subscribeDeviceMock.mock.invocationCallOrder[0],
    );
  });

  it("does not store renewal authority if channel subscription fails", async () => {
    subscribeDeviceMock.mockRejectedValueOnce(new Error("channel failed"));
    await expect(activatePush("user_1")).rejects.toThrow("channel failed");
    expect(rememberRenewalMock).not.toHaveBeenCalled();
  });

  it("keeps foreground activation usable when renewal storage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rememberRenewalMock.mockRejectedValueOnce(new Error("storage unavailable"));
    expect(await activatePush("user_1")).toBe(true);
  });

  it("activates again after the one before it finished", async () => {
    await activatePush("user_1");
    activateMock.mockClear();

    await activatePush("user_1");

    expect(activateMock).toHaveBeenCalled();
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

  // SOK-1120: logout can remove the identity token but leave SDK activation state.
  it("resets local SDK state without remote deregistration when its token is missing", async () => {
    localStorage.clear();
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    needsResetMock
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    getDeviceMock.mockResolvedValue({ id: "old-device" });
    deactivateMock.mockResolvedValue(undefined);
    await activatePush("user_1");
    expect(deactivateMock).toHaveBeenLastCalledWith(expect.any(Function));
  });
});
