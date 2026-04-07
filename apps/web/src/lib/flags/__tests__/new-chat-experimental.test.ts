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

describe("newChatExperimentalEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { newChatExperimentalEnabled } = await import(
      "../new-chat-experimental"
    );

    await expect(newChatExperimentalEnabled()).resolves.toBe(false);
  });

  it.each([
    "member@nmkr.io",
    "MEMBER@NMKR.IO",
  ])("returns true for @nmkr.io email %s", async (email) => {
    getSessionMock.mockResolvedValue({
      user: { email },
    });

    const { newChatExperimentalEnabled } = await import(
      "../new-chat-experimental"
    );

    await expect(newChatExperimentalEnabled()).resolves.toBe(true);
  });

  it("returns false for other domains", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "someone@example.com" },
    });

    const { newChatExperimentalEnabled } = await import(
      "../new-chat-experimental"
    );

    await expect(newChatExperimentalEnabled()).resolves.toBe(false);
  });

  it("isNewChatExperimentalAllowedEmail matches only nmkr.io", async () => {
    const { isNewChatExperimentalAllowedEmail } = await import(
      "../new-chat-experimental"
    );

    expect(isNewChatExperimentalAllowedEmail("a@nmkr.io")).toBe(true);
    expect(isNewChatExperimentalAllowedEmail("a@nmkr.io ")).toBe(false);
    expect(isNewChatExperimentalAllowedEmail("a@nmkr.io.fake")).toBe(false);
    expect(isNewChatExperimentalAllowedEmail(null)).toBe(false);
    expect(isNewChatExperimentalAllowedEmail("invalid-email")).toBe(false);
  });
});
