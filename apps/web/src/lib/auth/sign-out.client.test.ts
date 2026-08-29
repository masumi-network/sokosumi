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
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    releaseMock.mockResolvedValue(undefined);
    signOutMock.mockResolvedValue({ data: null, error: null });
  });

  /**
   * Deactivation mints an Ably token, so it needs the session that is about to
   * end. This is the contract the wrapper exists to hold; inverted, the release
   * silently stops working and every test above it still passes.
   */
  it("releases the push device before it ends the session", async () => {
    await signOutWithPushRelease("user_1");

    expect(calls).toEqual(["release", "signOut"]);
    expect(releaseMock).toHaveBeenCalledWith("user_1");
  });

  it("passes the caller's options straight through", async () => {
    const options = { fetchOptions: { onError: () => {} } };

    await signOutWithPushRelease("user_1", options);

    expect(signOutMock).toHaveBeenCalledWith(options);
  });

  /**
   * A browser with no push registration still signs out, and pays nothing for
   * the check.
   */
  it("signs out when there is no session user", async () => {
    await signOutWithPushRelease(undefined);

    expect(calls).toEqual(["release", "signOut"]);
    expect(releaseMock).toHaveBeenCalledWith(undefined);
  });
});
