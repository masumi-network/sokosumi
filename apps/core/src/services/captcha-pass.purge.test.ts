import { beforeEach, describe, expect, it, vi } from "vitest";

const { verificationDeleteManyMock } = vi.hoisted(() => ({
  verificationDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { verification: { deleteMany: verificationDeleteManyMock } },
}));

import { purgeExpiredCaptchaPasses } from "./captcha-pass.purge";

const NOW = new Date("2026-10-05T08:00:00.000Z");

describe("purgeExpiredCaptchaPasses", () => {
  beforeEach(() => {
    verificationDeleteManyMock.mockReset().mockResolvedValue({ count: 3 });
  });

  it("deletes only captcha pass rows whose expiry has passed", async () => {
    const result = await purgeExpiredCaptchaPasses({ now: NOW });

    expect(result).toEqual({ purged: 3 });
    expect(verificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        identifier: { startsWith: "captcha-pass:" },
        expiresAt: { lte: NOW },
      },
    });
  });

  it("deletes nothing once the sync deadline has passed", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await purgeExpiredCaptchaPasses({
      now: NOW,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ purged: 0 });
    expect(verificationDeleteManyMock).not.toHaveBeenCalled();
  });
});
