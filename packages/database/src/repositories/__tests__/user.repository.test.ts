import { beforeEach, describe, expect, it, vi } from "vitest";

import { userRepository } from "../user.repository.js";

const findManyMock = vi.fn();

const tx = {
  user: {
    findMany: findManyMock,
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
