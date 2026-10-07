import { beforeEach, describe, expect, it, vi } from "vitest";

const { verificationDeleteManyMock } = vi.hoisted(() => ({
  verificationDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { verification: { deleteMany: verificationDeleteManyMock } },
}));

import { purgeExpiredVerifications } from "./expired-verifications.purge";

const NOW = new Date("2026-10-05T08:00:00.000Z");

describe("purgeExpiredVerifications", () => {
  beforeEach(() => {
    verificationDeleteManyMock.mockReset().mockResolvedValue({ count: 3 });
  });

  it("deletes only Core's own rows whose expiry has passed", async () => {
    const result = await purgeExpiredVerifications({ now: NOW });

    expect(result).toEqual({ purged: 3 });
    expect(verificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { identifier: { startsWith: "captcha-pass:" } },
          { identifier: { startsWith: "sign-up-conversion:" } },
          { identifier: { startsWith: "sign-up-conversion-redirect:" } },
        ],
        expiresAt: { lte: NOW },
      },
    });
  });

  it("deletes nothing once the sync deadline has passed", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await purgeExpiredVerifications({
      now: NOW,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ purged: 0 });
    expect(verificationDeleteManyMock).not.toHaveBeenCalled();
  });
});
