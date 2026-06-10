import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const searchAdminUsersMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    searchAdminUsers: (...args: unknown[]) => searchAdminUsersMock(...args),
  },
  CoreApiRequestError: class extends Error {},
}));

import { adminUserService } from "../admin-user.service";

describe("adminUserService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps core results to user options", async () => {
    searchAdminUsersMock.mockResolvedValue({
      data: [{ id: "u1", name: "Ada", email: "ada@example.com", role: "user" }],
    });

    const result = await adminUserService.searchUsers("ada");

    expect(searchAdminUsersMock).toHaveBeenCalledWith("ada");
    expect(result).toEqual([
      { id: "u1", name: "Ada", email: "ada@example.com" },
    ]);
  });
});
