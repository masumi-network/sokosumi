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

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("hermesBetaEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { hermesBetaEnabled } = await import("../hermes-beta");

    await expect(hermesBetaEnabled()).resolves.toBe(false);
  });

  it.each([
    "user@nmkr.io",
    "USER@NMKR.IO",
  ])("returns true for beta domain %s", async (email) => {
    getSessionMock.mockResolvedValue({ user: { email } });

    const { hermesBetaEnabled } = await import("../hermes-beta");

    await expect(hermesBetaEnabled()).resolves.toBe(true);
  });

  it("returns false for other domains", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "someone@example.com" },
    });

    const { hermesBetaEnabled } = await import("../hermes-beta");

    await expect(hermesBetaEnabled()).resolves.toBe(false);
  });
});

describe("isHermesBetaAccessEmail", () => {
  it("matches nmkr.io only", async () => {
    const { isHermesBetaAccessEmail } = await import("../hermes-beta");

    expect(isHermesBetaAccessEmail("a@nmkr.io")).toBe(true);
    expect(isHermesBetaAccessEmail("a@sub.nmkr.io")).toBe(false);
    expect(isHermesBetaAccessEmail(null)).toBe(false);
    expect(isHermesBetaAccessEmail("not-an-email")).toBe(false);
  });
});
