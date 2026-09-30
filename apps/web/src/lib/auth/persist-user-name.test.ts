import { beforeEach, describe, expect, it, vi } from "vitest";

import { authClient } from "@/lib/auth/auth.client";

import { persistFirstAndLastName, userHasName } from "./persist-user-name";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: vi.fn(),
    getSession: (...args: unknown[]) => getSessionMock(...args),
  },
}));

describe("userHasName", () => {
  it("is false for blank names", () => {
    expect(userHasName("")).toBe(false);
    expect(userHasName("   ")).toBe(false);
    expect(userHasName(null)).toBe(false);
    expect(userHasName(undefined)).toBe(false);
  });

  it("is true for a trimmed name", () => {
    expect(userHasName("Ada")).toBe(true);
    expect(userHasName("  Ada  ")).toBe(true);
  });
});

const ADA = { firstName: "Ada", lastName: "Lovelace" };

describe("persistFirstAndLastName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      data: { user: { name: "" } },
      error: null,
    });
  });
  it("derives the display name for a user who has none", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const result = await persistFirstAndLastName(ADA, " ");

    expect(result.isOk()).toBe(true);
    expect(authClient.updateUser).toHaveBeenLastCalledWith({
      ...ADA,
      name: "Ada Lovelace",
    });
  });

  it("leaves an existing display name alone", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await persistFirstAndLastName(ADA, "Countess of Lovelace");

    expect(authClient.updateUser).toHaveBeenLastCalledWith(ADA);
  });

  it("preserves a name saved after the initial session was read", async () => {
    getSessionMock.mockResolvedValue({
      data: { user: { name: "Countess of Lovelace" } },
      error: null,
    });
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await persistFirstAndLastName(ADA, "");

    expect(authClient.updateUser).toHaveBeenLastCalledWith(ADA);
    expect(getSessionMock).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    });
  });

  it("does not overwrite names when the current session cannot be read", async () => {
    getSessionMock.mockResolvedValue({
      data: null,
      error: { message: "Session unavailable" },
    });

    const result = await persistFirstAndLastName(ADA, "");

    expect(result.isErr()).toBe(true);
    expect(authClient.updateUser).not.toHaveBeenCalled();
  });

  it("returns err with the update message when updateUser fails", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: { message: "Name rejected" },
    });

    const result = await persistFirstAndLastName(ADA, "");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Name rejected");
    }
  });
});
