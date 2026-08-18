import { describe, expect, it, vi } from "vitest";

import { authClient } from "@/lib/auth/auth.client";

import { persistUserName, userHasName } from "../persist-user-name";

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

describe("persistUserName", () => {
  it("returns ok when updateUser succeeds", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const result = await persistUserName("Ada");

    expect(result.isOk()).toBe(true);
  });

  it("returns err with the update message when updateUser fails", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValueOnce({
      data: null,
      error: { message: "Name rejected" },
    });

    const result = await persistUserName("Ada");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Name rejected");
    }
  });
});
