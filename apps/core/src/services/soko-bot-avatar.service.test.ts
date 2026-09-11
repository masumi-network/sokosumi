import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  avatarCountMock,
  avatarCreateMock,
  avatarFindManyMock,
  getEnvMock,
  putMock,
} = vi.hoisted(() => ({
  avatarCountMock: vi.fn(),
  avatarCreateMock: vi.fn(),
  avatarFindManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: async () => ({
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotAvatar: {
      count: avatarCountMock,
      findMany: avatarFindManyMock,
      create: avatarCreateMock,
    },
  },
}));

import { LIMITS } from "@/config/constants";
import {
  AVATAR_POOL_FLOOR,
  generateAvatars,
  listAvailableAvatars,
  persistAvatarImage,
  stockAvatarPool,
  topUpAvailableAvatars,
} from "@/services/soko-bot-avatar.service";

describe("Soko Bot avatar pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ FAL_KEY: "fal-test" });
    avatarFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("never generates for a plain read, so a page render cannot stall on fal.ai", async () => {
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(12);

    // The sidebar reads on every route; stocking is the cron's job there.
    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(avatarFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("buys one image, not six, when storing them is broken", async () => {
    // fal bills for an image whether or not we store it. With a broken blob
    // token the pool never fills, so an ungated run would buy six every cron
    // tick for ever while writing nothing louder than a warning.
    getEnvMock.mockReturnValue({
      FAL_KEY: "key",
      BLOB_READ_WRITE_TOKEN: "token",
    });
    avatarFindManyMock.mockResolvedValue([]);
    // Two fetches per draw: the billed generation, then the download we store.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);
    putMock.mockRejectedValue(new Error("blob token rejected"));

    const generated = await generateAvatars(6);

    expect(generated).toBe(0);
    // One billed generation, then it stops rather than paying for five more.
    const billed = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("fal.run"),
    );
    expect(billed).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("puts the PNG under soko-bots/avatars/{key}-{12hex}.png", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash12 = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 12);
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "token" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    putMock.mockResolvedValue({ url: "https://blob.test/owl.png" });

    await persistAvatarImage("https://fal.test/a.png", "owl-1");

    const pathname = putMock.mock.calls[0]?.[0];
    expect(pathname).toBe(`soko-bots/avatars/owl-1-${hash12}.png`);
    expect(pathname).not.toContain("soko-bot-avatars/");
  });

  it("fills a short pool when the caller asks to top up", async () => {
    // Vercel runs crons on production only, so the creation picker asks for
    // this explicitly rather than showing an empty grid on a preview.
    avatarCountMock.mockResolvedValue(0);

    await topUpAvailableAvatars(6);

    expect(avatarCountMock).toHaveBeenCalled();
  });

  it("ignores excludeIds when deciding whether to generate", async () => {
    // A caller can list the pool through the GET and hand the ids straight
    // back. Counting through that filter drove `available` to zero and bought
    // FAL images for a pool that needed nothing.
    avatarCountMock.mockResolvedValue(24);

    await topUpAvailableAvatars(6, {
      excludeIds: ["a", "b", "c", "d", "e", "f"],
    });

    expect(avatarCountMock).toHaveBeenCalledWith({
      where: { claimedBySokoBotId: null },
    });
  });

  it("stamps generated rows with the user who asked for them", async () => {
    // The per-user cap counts these rows. A user-triggered run that writes a
    // null here is FAL spend charged to nobody, so the cap never sees it.
    avatarCountMock.mockResolvedValue(0);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);

    await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });

    expect(avatarCreateMock).toHaveBeenCalled();
    for (const call of avatarCreateMock.mock.calls) {
      expect(call[0].data.requestedByUserId).toBe("user-1");
    }
  });

  it("leaves the pool cron's rows unattributed", async () => {
    // Nobody asked for these, so counting them against a user would spend that
    // user's allowance on work they never triggered.
    avatarCountMock.mockResolvedValue(0);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);

    await stockAvatarPool();

    expect(avatarCreateMock).toHaveBeenCalled();
    for (const call of avatarCreateMock.mock.calls) {
      expect(call[0].data.requestedByUserId).toBeNull();
    }
  });

  it("refuses to generate once the user is over the hourly cap", async () => {
    // The pool check is not a limit: it only asks whether the pool is short, so
    // a caller who keeps it short keeps buying FAL images. This counts what the
    // user actually caused.
    avatarCountMock
      // The unclaimed pool: short, so generation would otherwise run.
      .mockResolvedValueOnce(0)
      // What this user already caused in the window.
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toMatchObject({ status: 429 });

    expect(avatarCreateMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts exactly the last hour, and only that user's rows", async () => {
    // Pin the window length. Asserting only `instanceof Date` let the window
    // shrink to 1ms, which makes the cap unreachable while the suite stays
    // green. An all-time count would instead lock a user out for ever.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      avatarCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
          arrayBuffer: async () => new ArrayBuffer(8),
        }),
      );

      await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });

      const [where] = avatarCountMock.mock.calls[1] ?? [];
      expect(where.where.requestedByUserId).toBe("user-1");
      expect(where.where.createdAt.gte).toEqual(
        new Date("2026-09-11T11:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shrinks the batch to the remaining allowance instead of overshooting", async () => {
    // A plain "are you under the cap" check passes a user sitting at 23 and
    // then generates a full batch of 6, finishing at 29 against a cap of 24.
    avatarCountMock
      // Unclaimed pool: empty, so the full page would otherwise be generated.
      .mockResolvedValueOnce(0)
      // Already caused this hour: one short of the cap.
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR - 1);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);

    await topUpAvailableAvatars(6, { requestedByUserId: "user-1" });

    // Exactly one image bought, not six.
    expect(avatarCreateMock).toHaveBeenCalledTimes(1);
    const billed = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("fal.run"),
    );
    expect(billed).toHaveLength(1);
  });

  it("never consults the cap while the pool is full", async () => {
    // Reads are free, so browsing a stocked pool must not depend on how much
    // allowance the caller has left. The name is deliberately about the full
    // pool: a capped caller whose pool is SHORT still loses the read to a 429
    // at this layer, which is the gap the reserving layer closes.
    // The pool has to come back populated: asserting an empty array here would
    // pass just as well if the read had been swallowed entirely.
    avatarCountMock.mockResolvedValue(AVATAR_POOL_FLOOR);
    avatarFindManyMock.mockResolvedValue([
      { id: "a", imageUrl: "https://blob.test/a.png", subject: "owl" },
      { id: "b", imageUrl: "https://blob.test/b.png", subject: "fox" },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).resolves.toHaveLength(2);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(avatarFindManyMock).toHaveBeenCalledTimes(1);
    // One count only: the pool. A second would be the allowance count, which
    // is what "never consults the cap" means and what earns the name.
    expect(avatarCountMock).toHaveBeenCalledTimes(1);
  });

  it("lets the pool cron generate without a user allowance", async () => {
    // Nobody asked for a refill, so there is no user to charge and no cap to
    // apply. Counting it against someone would burn an allowance they never
    // spent.
    avatarCountMock.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
        arrayBuffer: async () => new ArrayBuffer(8),
      }),
    );

    await expect(stockAvatarPool()).resolves.toBeDefined();
    expect(avatarCreateMock).toHaveBeenCalled();
  });

  it("never counts or generates on a plain read", async () => {
    // The read is a GET. A GET that bills FAL is reachable cross-site on a
    // top-level navigation, because the session cookie is SameSite=Lax.
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(6);

    expect(avatarCountMock).not.toHaveBeenCalled();
  });
});
