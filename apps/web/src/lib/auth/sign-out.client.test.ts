import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const releaseMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/lib/ably/release-push-device.client", () => ({
  releasePushDeviceOnSignOut: (...args: unknown[]) => {
    calls.push("release");
    return releaseMock(...args);
  },
}));

vi.mock("./auth.client", () => ({
  signOut: (...args: unknown[]) => {
    calls.push("signOut");
    return signOutMock(...args);
  },
}));

import { signOutWithPushRelease } from "./sign-out.client";

describe("signOutWithPushRelease", () => {
  let assignSpy: ReturnType<typeof vi.spyOn>;
  let reloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    releaseMock.mockResolvedValue(undefined);
    signOutMock.mockResolvedValue({ data: null, error: null });
    window.history.replaceState({}, "", "/tasks?tab=all");
    assignSpy = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    reloadSpy = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
  });

  /**
   * Deactivation mints an Ably token, so it needs the session that is about to
   * end. This is the contract the wrapper exists to hold; inverted, the release
   * silently stops working and every test above it still passes.
   *
   * The release is held open rather than merely ordered, because invocation
   * order alone passes for a dropped `await` too: the release would start,
   * the session would end under it, and the token mint would fail.
   */
  it("waits for the release to finish before it ends the session and loads /signin as a full document", async () => {
    let finishRelease: () => void = () => {};
    releaseMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRelease = resolve;
      }),
    );

    const signingOut = signOutWithPushRelease("user_1");
    await Promise.resolve();

    expect(releaseMock).toHaveBeenCalledWith("user_1");
    expect(signOutMock).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();

    finishRelease();
    await signingOut;

    expect(calls).toEqual(["release", "signOut"]);
    expect(assignSpy).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Ftasks%3Ftab%3Dall",
    );
  });

  it("passes the caller's fetchOptions straight through and reloads in place when requested", async () => {
    const fetchOptions = { onError: () => {} };

    await signOutWithPushRelease("user_1", {
      afterSignOut: "reload",
      fetchOptions,
    });

    expect(signOutMock).toHaveBeenCalledWith({ fetchOptions });
    expect(reloadSpy).toHaveBeenCalledOnce();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("does not navigate when signOut returns an error", async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: "Internal Server Error" },
    });

    await signOutWithPushRelease("user_1");

    expect(assignSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  /**
   * A browser with no push registration still signs out, and pays nothing for
   * the check.
   */
  it("signs out when there is no session user", async () => {
    await signOutWithPushRelease(undefined);

    expect(calls).toEqual(["release", "signOut"]);
    expect(releaseMock).toHaveBeenCalledWith(undefined);
    expect(assignSpy).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Ftasks%3Ftab%3Dall",
    );
  });
});
