import { describe, expect, it, vi } from "vitest";

import { authClient } from "@/lib/auth/auth.client";

import { persistFirstAndLastName, userHasName } from "./persist-user-name";

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: vi.fn(),
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
