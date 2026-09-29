import { beforeEach, describe, expect, it, vi } from "vitest";

const { dropSubscription, revokeRenewal, recordOutcome } = vi.hoisted(() => ({
  dropSubscription: vi.fn(),
  revokeRenewal: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock("./push-activation.client", () => ({
  dropBrowserPushSubscription: dropSubscription,
}));
vi.mock("./push-renewal.client", () => ({
  revokePushRenewal: revokeRenewal,
}));
vi.mock("./push-repair-outcome.client", () => ({
  recordPushRepairOutcome: recordOutcome,
}));

import {
  handleRevokedPushDevice,
  stopRevokedPushDevice,
} from "./push-revocation.client";
import {
  getPushTeardownVersion,
  queuePushWork,
} from "./push-work-queue.client";

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  dropSubscription.mockResolvedValue(undefined);
  revokeRenewal.mockResolvedValue(undefined);
  recordOutcome.mockResolvedValue(undefined);
  localStorage.setItem("sokosumi.push.deviceOwner", "user-1");
  localStorage.setItem("ably.push.deviceIdentityToken", "token");
  localStorage.setItem(
    "sokosumi.push.preference",
    JSON.stringify({
      userId: "user-1",
      suspended: false,
    }),
  );
});

describe("push revocation cleanup", () => {
  it("fences running activation before waiting for the push queue", async () => {
    let finish = () => {};
    let started = false;
    const pending = queuePushWork(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          started = true;
        }),
    );
    await vi.waitFor(() => expect(started).toBe(true));
    const previousVersion = getPushTeardownVersion();
    const cleanup = handleRevokedPushDevice("user-1");
    expect(getPushTeardownVersion()).not.toBe(previousVersion);
    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBe("1");
    expect(localStorage.getItem("sokosumi.push.preference")).toBeNull();
    await vi.waitFor(() => expect(revokeRenewal).toHaveBeenCalled());
    expect(recordOutcome).toHaveBeenCalledWith({ notify: true });
    expect(dropSubscription).not.toHaveBeenCalled();
    finish();
    await pending;
    await cleanup;
    expect(dropSubscription).toHaveBeenCalledOnce();
  });

  it("queues cleanup before a later enable while notification is pending", async () => {
    let finishNotification = () => {};
    recordOutcome.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishNotification = resolve;
      }),
    );
    const order: string[] = [];
    dropSubscription.mockImplementation(async () => {
      order.push("off");
    });
    const cleanup = handleRevokedPushDevice("user-1");
    const enable = queuePushWork(async () => {
      order.push("on");
    });
    finishNotification();
    await Promise.all([cleanup, enable]);
    expect(order).toEqual(["off", "on"]);
  });

  it("still cleans up if notifying browser state readers fails", async () => {
    const error = new Error("Listener failed");
    recordOutcome.mockRejectedValue(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleRevokedPushDevice("user-1");
      expect(dropSubscription).toHaveBeenCalledOnce();
      expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
      expect(report).toHaveBeenCalledWith(
        "Failed to report push revocation",
        error,
      );
    } finally {
      report.mockRestore();
    }
  });

  it("keeps intentional off and clears credentials when local unsubscribe fails", async () => {
    dropSubscription.mockRejectedValueOnce(new Error("Browser unavailable"));
    await expect(handleRevokedPushDevice("user-1")).rejects.toThrow(
      "Browser unavailable",
    );
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
    expect(localStorage.getItem("sokosumi.push.teardownStarted")).toBe("1");
    expect(recordOutcome).toHaveBeenLastCalledWith({ notify: true });
  });

  it("does not take the push queue again during activation cleanup", async () => {
    await queuePushWork(() => stopRevokedPushDevice("user-1"));
    expect(dropSubscription).toHaveBeenCalledOnce();
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  it("does not stop another account's device", async () => {
    await handleRevokedPushDevice("user-2");
    expect(dropSubscription).not.toHaveBeenCalled();
    expect(revokeRenewal).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBe("token");
  });
});
