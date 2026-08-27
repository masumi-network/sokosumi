import { beforeEach, describe, expect, it, vi } from "vitest";

const { avatarCountMock, avatarFindManyMock, getEnvMock, putMock } = vi.hoisted(
  () => ({
    avatarCountMock: vi.fn(),
    avatarFindManyMock: vi.fn(),
    getEnvMock: vi.fn(),
    putMock: vi.fn(),
  }),
);

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotAvatar: {
      count: avatarCountMock,
      findMany: avatarFindManyMock,
      create: vi.fn(),
    },
  },
}));

import {
  AVATAR_POOL_FLOOR,
  listAvailableAvatars,
  stockAvatarPool,
} from "@/services/soko-bot-avatar.service";

describe("Soko Bot avatar pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ FAL_KEY: "fal-test" });
    avatarFindManyMock.mockResolvedValue([]);
  });

  it("does nothing without an image key, so the pool just stays empty", async () => {
    getEnvMock.mockReturnValue({});
    avatarCountMock.mockResolvedValue(0);

    await expect(stockAvatarPool()).resolves.toEqual({
      available: 0,
      generated: 0,
    });
    expect(avatarCountMock).not.toHaveBeenCalled();
  });

  it("leaves a full pool alone", async () => {
    avatarCountMock.mockResolvedValue(AVATAR_POOL_FLOOR);

    await expect(stockAvatarPool()).resolves.toEqual({
      available: AVATAR_POOL_FLOOR,
      generated: 0,
    });
  });

  it("never generates while reading, so a page render cannot stall on fal.ai", async () => {
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(12);

    // A short pool returns fewer choices; stocking is the cron's job.
    expect(putMock).not.toHaveBeenCalled();
    expect(avatarFindManyMock).toHaveBeenCalledTimes(1);
  });
});
