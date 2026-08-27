import { beforeEach, describe, expect, it, vi } from "vitest";

import { userRepository } from "./user.repository.js";

const findManyMock = vi.fn();
const countMock = vi.fn();

const tx = {
  user: {
    findMany: findManyMock,
    count: countMock,
  },
} as never;

describe("userRepository.searchUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
    ]);
  });

  it("matches name or email case-insensitively, ordered and limited", async () => {
    const result = await userRepository.searchUsers("ada", 20, tx);

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "ada", mode: "insensitive" } },
          { email: { contains: "ada", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    expect(result).toEqual([
      { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
    ]);
  });

  it("trims the query before searching", async () => {
    await userRepository.searchUsers("  ada  ", 5, tx);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "ada", mode: "insensitive" } },
            { email: { contains: "ada", mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
    );
  });

  it("short-circuits to an empty array for blank queries without querying", async () => {
    await expect(userRepository.searchUsers("", 20, tx)).resolves.toEqual([]);
    await expect(userRepository.searchUsers("   ", 20, tx)).resolves.toEqual(
      [],
    );
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("userRepository.listUsersForAdminOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);
    countMock.mockResolvedValue(1);
  });

  it("lists users newest-first with pagination args and total", async () => {
    const result = await userRepository.listUsersForAdminOverview(
      { take: 21, skip: 1, cursor: "user_0" },
      tx,
    );

    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      skip: 1,
      cursor: { id: "user_0" },
    });
    expect(countMock).toHaveBeenCalledWith({ where: {} });
    expect(result.total).toBe(1);
    expect(result.users).toHaveLength(1);
  });

  it("filters by name or email when a query is given", async () => {
    await userRepository.listUsersForAdminOverview(
      { query: "  ada  ", take: 21 },
      tx,
    );

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "ada", mode: "insensitive" } },
            { email: { contains: "ada", mode: "insensitive" } },
          ],
        },
        cursor: undefined,
        skip: undefined,
      }),
    );
    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "ada", mode: "insensitive" } },
          { email: { contains: "ada", mode: "insensitive" } },
        ],
      },
    });
  });
});
