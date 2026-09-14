import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  avatarCountMock,
  avatarCreateMock,
  avatarDeleteManyMock,
  avatarFindManyMock,
  avatarUpdateMock,
  getEnvMock,
  putMock,
} = vi.hoisted(() => ({
  avatarCountMock: vi.fn(),
  avatarCreateMock: vi.fn(),
  avatarDeleteManyMock: vi.fn(),
  avatarFindManyMock: vi.fn(),
  avatarUpdateMock: vi.fn(),
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
const { avatarFindUniqueMock, avatarUpdateManyMock, sokoBotUpdateMock } =
  vi.hoisted(() => ({
    avatarFindUniqueMock: vi.fn(),
    avatarUpdateManyMock: vi.fn(),
    sokoBotUpdateMock: vi.fn(),
  }));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {} as never }));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBotAvatar: {
      count: avatarCountMock,
      findMany: avatarFindManyMock,
      findUnique: avatarFindUniqueMock,
      create: avatarCreateMock,
      update: avatarUpdateMock,
      updateMany: avatarUpdateManyMock,
      deleteMany: avatarDeleteManyMock,
    },
    sokoBot: { update: sokoBotUpdateMock },
    $transaction: (run: (tx: unknown) => unknown) => run(client),
  };
  Object.assign(prismaMock, client);
  return { default: client };
});

// Runs the callback against the same client. The point the tests assert is
// that reserving goes through this helper at all: counting the allowance and
// inserting the reservations have to be one atomic step, and this is the
// repo's Serializable wrapper.
const { serializableTransactionMock } = vi.hoisted(() => ({
  serializableTransactionMock: vi.fn(),
}));
// Spread the real module so `CONCURRENCY_CONFLICT_KIND` stays the value the
// service actually compares against; only the wrapper itself is replaced.
vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: serializableTransactionMock,
}));

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import {
  AVATAR_POOL_FLOOR,
  claimAvatar,
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
    // Reserving a draw returns the row it claimed.
    avatarCreateMock.mockResolvedValue({ id: "reserved-1" });
    avatarDeleteManyMock.mockResolvedValue({ count: 0 });
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) => await run(prismaMock),
    );
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
    // The upload is the one step of a fill with no natural time limit. Unbounded,
    // it can outlive the sweep cutoff and have its own reservation deleted.
    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
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
      where: { claimedBySokoBotId: null, reservedAt: null },
    });
    // The point of this test: no `id: { notIn: ... }` reached the count.
    expect(avatarCountMock.mock.calls[0][0].where).not.toHaveProperty("id");
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

  it("serves the pool when a concurrent top-up wins the race", async () => {
    // A lost serialization race surfaces as a retryable 409. It says nothing
    // about the rows already in the pool, so answering with an error would
    // blank a picker that had avatars to show.
    avatarCountMock.mockResolvedValue(0);
    avatarFindManyMock.mockResolvedValue([
      { id: "a", imageUrl: "https://blob.test/a.png", subject: "owl" },
    ]);
    serializableTransactionMock.mockRejectedValue(
      new HTTPException(409, {
        message: "Another avatar top-up is running. Try again.",
        cause: { kind: CONCURRENCY_CONFLICT_KIND },
      }),
    );

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).resolves.toHaveLength(1);
  });

  it("still reports the race when the pool has nothing to fall back on", async () => {
    // The fallback is a courtesy, not a way to swallow the conflict. With an
    // empty pool the caller gets the retryable 409 rather than a silent [].
    avatarCountMock.mockResolvedValue(0);
    avatarFindManyMock.mockResolvedValue([]);
    const conflictError = new HTTPException(409, {
      message: "Another avatar top-up is running. Try again.",
      cause: { kind: CONCURRENCY_CONFLICT_KIND },
    });
    serializableTransactionMock.mockRejectedValue(conflictError);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toBe(conflictError);
  });

  it("does not swallow a genuine fault as if it were a lost race", async () => {
    // Only a spent allowance and a lost race are recoverable. Anything else
    // has to surface, or a broken pool reads as a merely empty one.
    avatarCountMock.mockResolvedValue(0);
    avatarFindManyMock.mockResolvedValue([
      { id: "a", imageUrl: "https://blob.test/a.png", subject: "owl" },
    ]);
    const fault = new Error("prisma is down");
    serializableTransactionMock.mockRejectedValue(fault);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toBe(fault);
  });

  it("sweeps dead reservations on a top-up, not only on the cron", async () => {
    // Vercel runs crons on production only, and this route exists because
    // preview has none. Without this the row of a run that died on preview
    // holds its draw and the user's allowance until somebody ships to prod.
    avatarCountMock.mockResolvedValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
        arrayBuffer: async () => new ArrayBuffer(8),
      }),
    );

    await topUpAvailableAvatars(6, { requestedByUserId: "user-1" });

    const sweeps = avatarDeleteManyMock.mock.calls.filter(
      (call) => call[0]?.where?.reservedAt?.not === null,
    );
    expect(sweeps).toHaveLength(1);
  });

  it("survives a release that fails instead of raising a 500", async () => {
    // The release runs while handling a failure the caller is meant to live
    // through, and the blip that broke the run can break the delete too.
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" });
    avatarDeleteManyMock.mockRejectedValue(new Error("pool exhausted"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fal is down")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(generateAvatars(2)).resolves.toBe(0);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("still serves the pool to a capped user rather than only a 429", async () => {
    // Running out of allowance must not cost the caller the avatars that are
    // already sitting there. Reads are free; the cap guards the paid call.
    avatarCountMock
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR);
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

  it("claims the draw before it buys the image", async () => {
    // Order is the whole point. A row written only after the paid call lets
    // concurrent requests all read the same count and all pass the cap, and
    // lets a run that billed FAL but failed to store the image go uncounted.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let fetchMock: ReturnType<typeof vi.fn>;
    try {
      avatarCountMock.mockResolvedValue(0);
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
        arrayBuffer: async () => new ArrayBuffer(8),
      });
      vi.stubGlobal("fetch", fetchMock);

      await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });
    } finally {
      vi.useRealTimers();
    }

    const reservedOrder = avatarCreateMock.mock.invocationCallOrder[0];
    const billedOrder = fetchMock.mock.invocationCallOrder[0];
    expect(reservedOrder).toBeLessThan(billedOrder);
    // Pinned to the clock, not just `instanceof Date`. A reservation stamped
    // at the epoch is stale the moment it is written, so the sweep would
    // delete live reservations and the draw would become re-purchasable.
    expect(avatarCreateMock.mock.calls[0][0].data.reservedAt).toEqual(now);
    // The image lands on the row it already claimed, and clearing reservedAt
    // is what publishes it.
    expect(avatarUpdateMock).toHaveBeenCalledWith({
      where: { id: "reserved-1" },
      data: {
        imageUrl: expect.any(String),
        sourceUrl: "https://fal.test/a.png",
        reservedAt: null,
      },
    });
  });

  it("counts the allowance and claims the slots in one atomic step", async () => {
    // As two statements, concurrent requests all read the same count, all
    // pass, and each buys a full batch. Reserving does not fix that on its
    // own, because the count still happens first. Serializable does.
    avatarCountMock.mockResolvedValue(0);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);
    // Sampled when the transaction callback returns, not when it was entered.
    // Entry order alone proves nothing: `serializableTransaction` is entered
    // before anything its callback does, so moving the paid call inside the
    // callback would still satisfy it.
    let billedCallsWhenTxClosed = -1;
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) => {
        const result = await run(prismaMock);
        billedCallsWhenTxClosed = fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("fal.run"),
        ).length;
        return result;
      },
    );

    await generateAvatars(2, "user-1");

    expect(serializableTransactionMock).toHaveBeenCalledTimes(1);
    // Exactly what was asked for, clamped by the draws available, not by the
    // whole remaining allowance of 24.
    expect(avatarCreateMock).toHaveBeenCalledTimes(2);
    // The allowance count and every claim ran inside the transaction; the paid
    // call ran only after it closed. A transaction that waits on FAL holds a
    // pool connection for the whole run.
    expect(billedCallsWhenTxClosed).toBe(0);
    const billedAfter = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("fal.run"),
    ).length;
    expect(billedAfter).toBe(2);
  });

  it("hands back the slots it never spent on", async () => {
    // The probe failing means the rest were never attempted. Leaving their
    // rows behind would bill the user's allowance for images nobody bought and
    // hide those draws from every later run.
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" })
      .mockResolvedValueOnce({ id: "reserved-3" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fal is down")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(generateAvatars(3)).resolves.toBe(0);
    } finally {
      error.mockRestore();
    }

    expect(avatarDeleteManyMock).toHaveBeenCalledWith({
      // The probe's row stays: FAL may already have billed for it.
      where: { id: { in: ["reserved-2", "reserved-3"] } },
    });
  });

  it("reports how many images it actually added", async () => {
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" })
      .mockResolvedValueOnce({ id: "reserved-3" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Probe succeeds, then one of the two remaining fills fails.
      avatarUpdateMock
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("blob rejected"))
        .mockResolvedValueOnce({});
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
          arrayBuffer: async () => new ArrayBuffer(8),
        }),
      );

      await expect(generateAvatars(3)).resolves.toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses to hand a bot an avatar whose image is still in flight", async () => {
    // Claiming one would set the bot's avatar to an empty URL that nothing
    // ever fills in.
    avatarFindUniqueMock.mockResolvedValue({
      id: "reserved-1",
      imageUrl: "",
      claimedBySokoBotId: null,
      reservedAt: new Date(),
    });

    await expect(claimAvatar("bot-1", "reserved-1")).rejects.toThrow();

    expect(avatarUpdateManyMock).not.toHaveBeenCalled();
    expect(sokoBotUpdateMock).not.toHaveBeenCalled();
  });

  it("hides reserved rows from the picker", async () => {
    // A reserved row has no image, so showing it would render a blank tile.
    // This covers the read only. The availability count is pinned separately,
    // by "ignores excludeIds when deciding whether to generate", which asserts
    // the same filter reaches `count`.
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(6);

    expect(avatarFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedBySokoBotId: null,
          reservedAt: null,
        }),
      }),
    );
  });

  it("sweeps reservations whose run never finished", async () => {
    // A process killed between claiming a draw and storing its image holds
    // that (subject, background, seed) against every future run.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      avatarCountMock.mockResolvedValue(AVATAR_POOL_FLOOR);

      await stockAvatarPool();

      expect(avatarDeleteManyMock).toHaveBeenCalledWith({
        where: {
          reservedAt: { not: null },
          // Aged off `createdAt`, the same column the cap reads, so the two
          // windows cancel and sweeping never returns allowance early.
          createdAt: { lt: new Date("2026-09-11T11:00:00.000Z") },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never counts or generates on a plain read", async () => {
    // The read is a GET. A GET that bills FAL is reachable cross-site on a
    // top-level navigation, because the session cookie is SameSite=Lax.
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(6);

    expect(avatarCountMock).not.toHaveBeenCalled();
  });
});
