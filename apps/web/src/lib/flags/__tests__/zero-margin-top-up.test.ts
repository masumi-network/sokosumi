import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();

vi.mock("flags/next", () => ({
  flag: ({
    decide,
  }: {
    key: string;
    decide: () => boolean | Promise<boolean>;
  }) => decide,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("zeroMarginTopUpEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { zeroMarginTopUpEnabled } = await import("../zero-margin-top-up");

    await expect(zeroMarginTopUpEnabled()).resolves.toBe(false);
  });

  it.each([
    "member@house-of-communication.com",
    "member@masumi.network",
    "member@nmkr.io",
    "member@nayokimediaplus.com",
    "member@serviceplan.com",
    "MEMBER@NMKR.IO",
  ])("returns true for allowed domain %s", async (email) => {
    getSessionMock.mockResolvedValue({
      user: { email },
    });

    const { zeroMarginTopUpEnabled } = await import("../zero-margin-top-up");

    await expect(zeroMarginTopUpEnabled()).resolves.toBe(true);
  });

  it("returns false for non-allowlisted external emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "someone@example.com" },
    });

    const { zeroMarginTopUpEnabled } = await import("../zero-margin-top-up");

    await expect(zeroMarginTopUpEnabled()).resolves.toBe(false);
  });

  it("returns false for invalid email values", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "invalid-email" },
    });

    const { zeroMarginTopUpEnabled } = await import("../zero-margin-top-up");

    await expect(zeroMarginTopUpEnabled()).resolves.toBe(false);
  });

  it("resolves the override lookup key only for allowlisted emails", async () => {
    const { resolveZeroMarginTopUpLookupKey } = await import(
      "../zero-margin-top-up"
    );

    expect(resolveZeroMarginTopUpLookupKey("member@nmkr.io")).toBe(
      "credit_0_margin",
    );
    expect(
      resolveZeroMarginTopUpLookupKey("member@example.com"),
    ).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey(null)).toBeUndefined();
  });
});
