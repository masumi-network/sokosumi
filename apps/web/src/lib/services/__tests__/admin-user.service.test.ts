import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const searchAdminUsersMock = vi.fn();
const listAdminUsersMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    searchAdminUsers: (...args: unknown[]) => searchAdminUsersMock(...args),
    listAdminUsers: (...args: unknown[]) => listAdminUsersMock(...args),
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

  it("maps overview rows and pagination", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    listAdminUsersMock.mockResolvedValue({
      data: [
        {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          createdAt,
          credits: 42.5,
          subscriptionPlan: "pro",
          subscriptionStatus: "active",
          startedTaskCount: 7,
        },
      ],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_1",
        pagination: { cursor: null, limit: 20, total: 1, nextCursor: null },
      },
    });

    const result = await adminUserService.listUsers({ query: "ada" });

    expect(listAdminUsersMock).toHaveBeenCalledWith({ query: "ada" });
    expect(result.users).toEqual([
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt,
        credits: 42.5,
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        startedTaskCount: 7,
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it("passes cursor and limit through and surfaces nextCursor", async () => {
    listAdminUsersMock.mockResolvedValue({
      data: [],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_2",
        pagination: {
          cursor: "user_0",
          limit: 10,
          total: 25,
          nextCursor: "user_9",
        },
      },
    });

    const result = await adminUserService.listUsers({
      cursor: "user_0",
      limit: 10,
    });

    expect(listAdminUsersMock).toHaveBeenCalledWith({
      cursor: "user_0",
      limit: 10,
    });
    expect(result.nextCursor).toBe("user_9");
    expect(result.total).toBe(25);
  });
});
