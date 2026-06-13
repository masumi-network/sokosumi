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
    "k.platz@house-of-communication.com",
    "K.PLATZ@HOUSE-OF-COMMUNICATION.COM",
  ])("returns true for beta access email %s", async (email) => {
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
