import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  avatarCountMock,
  avatarCreateMock,
  avatarDeleteManyMock,
  avatarFindManyMock,
  avatarUpdateMock,
  generateTextMock,
  getEnvMock,
  putMock,
} = vi.hoisted(() => ({
  avatarCountMock: vi.fn(),
  avatarCreateMock: vi.fn(),
  avatarDeleteManyMock: vi.fn(),
  avatarFindManyMock: vi.fn(),
  avatarUpdateMock: vi.fn(),
  generateTextMock: vi.fn(),
  getEnvMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ put: putMock }));
// The image model: one AI Gateway `generateText` call per image.
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: generateTextMock,
}));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: async () => ({
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  }),
}));
const {
  avatarFindUniqueMock,
  avatarUpdateManyMock,
  renderCreateManyMock,
  renderDeleteManyMock,
  sokoBotUpdateMock,
} = vi.hoisted(() => ({
  avatarFindUniqueMock: vi.fn(),
  avatarUpdateManyMock: vi.fn(),
  renderCreateManyMock: vi.fn(),
  renderDeleteManyMock: vi.fn(),
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
    sokoBotAvatarRender: {
      createMany: renderCreateManyMock,
      deleteMany: renderDeleteManyMock,
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
import { CRAFTED_DESK_STYLE } from "@/lib/soko-bot-avatar/style";
import {
  AVATAR_MODEL,
  claimAvatar,
  generateAvatars,
  listAvailableAvatars,
  sweepExpiredDrafts,
  takePoolLookAsDraft,
  topUpAvailableAvatars,
} from "@/services/soko-bot-avatar.service";

const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4]);

/** What the image model answers: one PNG among its files. */
function imageAnswer() {
  return { files: [{ mediaType: "image/png", uint8Array: IMAGE_BYTES }] };
}

/** How many images were bought. */
function billed() {
  return generateTextMock.mock.calls.length;
}

const ENV = { AI_GATEWAY_API_KEY: "gw-test", BLOB_READ_WRITE_TOKEN: "token" };

describe("Soko Bot avatar pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue(ENV);
    avatarFindManyMock.mockResolvedValue([]);
    avatarUpdateManyMock.mockResolvedValue({ count: 0 });
    // Reserving a draw returns the row it claimed.
    avatarCreateMock.mockResolvedValue({ id: "reserved-1" });
    avatarDeleteManyMock.mockResolvedValue({ count: 0 });
    generateTextMock.mockResolvedValue(imageAnswer());
    putMock.mockImplementation(async (pathname: string) => ({
      url: `https://blob.test/${pathname}`,
    }));
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) => await run(prismaMock),
    );
  });

  it("does nothing without a gateway key or blob store, so the pool just stays empty", async () => {
    getEnvMock.mockReturnValue({});
    avatarCountMock.mockResolvedValue(0);

    await expect(topUpAvailableAvatars(6)).resolves.toEqual([]);
    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(billed()).toBe(0);
  });

  it("never generates for a plain read, so a page render cannot stall on the image model", async () => {
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(12);

    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(billed()).toBe(0);
    expect(avatarFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("buys one image, not six, when storing them is broken", async () => {
    // The image model bills for an image whether or not we store it. With a
    // broken blob token the pool never fills, so an ungated run would buy six
    // on every top-up while writing nothing louder than a warning.
    putMock.mockRejectedValue(new Error("blob token rejected"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(generateAvatars(6)).resolves.toBe(0);
    } finally {
      error.mockRestore();
    }

    expect(billed()).toBe(1);
  });

  it("draws with the Gateway image model and the original prompt, and stores a PNG", async () => {
    const hash12 = createHash("sha256")
      .update(IMAGE_BYTES)
      .digest("hex")
      .slice(0, 12);

    await generateAvatars(1);

    const [call] = generateTextMock.mock.calls[0] ?? [];
    expect(call.model.modelId).toBe("google/gemini-3.1-flash-image");
    expect(call.prompt).toMatch(
      /^Create one complete full-bleed 1:1 square image\./,
    );
    expect(call.prompt).toContain("cute, endearing owl character");
    // The first draw of an empty pool: owl, seed 1.
    expect(putMock).toHaveBeenCalledWith(
      `soko-bots/avatars/owl-1-${hash12}.png`,
      expect.anything(),
      // The upload is the one step of a fill with no natural time limit.
      // Unbounded, it can outlive the sweep cutoff and lose its reservation.
      expect.objectContaining({
        contentType: "image/png",
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(avatarCreateMock.mock.calls[0]?.[0].data).toMatchObject({
      subject: "owl",
      seed: 1,
      model: AVATAR_MODEL,
    });
  });

  it("fills a short pool when the caller asks to top up", async () => {
    avatarCountMock.mockResolvedValue(0);

    await topUpAvailableAvatars(6);

    expect(avatarCountMock).toHaveBeenCalled();
    expect(billed()).toBe(6);
  });

  it("ignores excludeIds when deciding whether to generate", async () => {
    // A caller can list the pool through the GET and hand the ids straight
    // back. Counting through that filter drove `available` to zero and bought
    // images for a pool that needed nothing.
    avatarCountMock.mockResolvedValue(24);

    await topUpAvailableAvatars(6, {
      excludeIds: ["a", "b", "c", "d", "e", "f"],
    });

    // The point of this test: no `id: { notIn: ... }` reached the count.
    expect(avatarCountMock.mock.calls[0][0].where).not.toHaveProperty("id");
    expect(billed()).toBe(0);
  });

  it("stamps generated rows with the user who asked for them", async () => {
    // The per-user cap counts these rows. A user-triggered run that writes a
    // null here is spend charged to nobody, so the cap never sees it.
    avatarCountMock.mockResolvedValue(0);

    await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });

    expect(avatarCreateMock).toHaveBeenCalled();
    for (const call of avatarCreateMock.mock.calls) {
      expect(call[0].data.requestedByUserId).toBe("user-1");
    }
  });

  it("refuses to generate once the user is over the hourly cap", async () => {
    avatarCountMock
      // The unclaimed pool: short, so generation would otherwise run.
      .mockResolvedValueOnce(0)
      // What this user already caused in the window.
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toMatchObject({ status: 429 });

    expect(avatarCreateMock).not.toHaveBeenCalled();
    expect(billed()).toBe(0);
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

  it("sweeps dead reservations when it tops up, the only place that does", async () => {
    // There is no cron. Without this the row of a run that died holds its
    // draw and the user's allowance for ever.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      avatarCountMock.mockResolvedValue(0);

      await topUpAvailableAvatars(6, { requestedByUserId: "user-1" });

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

  it("survives a release that fails instead of raising a 500", async () => {
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" });
    avatarDeleteManyMock.mockRejectedValue(new Error("pool exhausted"));
    generateTextMock.mockRejectedValue(new Error("gateway is down"));
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
    avatarCountMock
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR);
    avatarFindManyMock.mockResolvedValue([
      { id: "a", imageUrl: "https://blob.test/a.png", subject: "owl" },
      { id: "b", imageUrl: "https://blob.test/b.png", subject: "fox" },
    ]);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).resolves.toHaveLength(2);

    expect(billed()).toBe(0);
  });

  it("counts exactly the last hour, and only that user's rows", async () => {
    // Pin the window length. An all-time count would lock a user out for
    // ever; a 1 ms window would make the cap unreachable.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      avatarCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });

      const [where] = avatarCountMock.mock.calls[1] ?? [];
      expect(where.where).toEqual({
        requestedByUserId: "user-1",
        createdAt: { gte: new Date("2026-09-11T11:00:00.000Z") },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shrinks the batch to the remaining allowance instead of overshooting", async () => {
    // A plain "are you under the cap" check passes a user sitting at 23 and
    // then generates a full batch of 6, finishing at 29 against a cap of 24.
    avatarCountMock
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR - 1);

    await topUpAvailableAvatars(6, { requestedByUserId: "user-1" });

    expect(avatarCreateMock).toHaveBeenCalledTimes(1);
    expect(billed()).toBe(1);
  });

  it("never consults the cap while the pool is full", async () => {
    avatarCountMock.mockResolvedValue(6);
    avatarFindManyMock.mockResolvedValue([
      { id: "a", imageUrl: "https://blob.test/a.png", subject: "owl" },
      { id: "b", imageUrl: "https://blob.test/b.png", subject: "fox" },
    ]);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).resolves.toHaveLength(2);

    expect(billed()).toBe(0);
    // One count only: the pool. A second would be the allowance count.
    expect(avatarCountMock).toHaveBeenCalledTimes(1);
  });

  it("claims the draw before it buys the image", async () => {
    // A row written only after the paid call lets concurrent requests all
    // read the same count and all pass the cap.
    const now = new Date("2026-09-11T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      avatarCountMock.mockResolvedValue(0);

      await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });
    } finally {
      vi.useRealTimers();
    }

    expect(avatarCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
      generateTextMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(avatarCreateMock.mock.calls[0][0].data.reservedAt).toEqual(now);
    // The image lands on the row it already claimed, and clearing reservedAt
    // is what publishes it. The write names only columns that stay.
    expect(avatarUpdateMock).toHaveBeenCalledWith({
      where: { id: "reserved-1" },
      data: { imageUrl: expect.any(String), reservedAt: null },
      select: { id: true },
    });
  });

  it("counts the allowance and claims the slots in one atomic step", async () => {
    // Sampled when the transaction callback returns: the paid call must run
    // only after it closed, or the transaction waits on the image model.
    let billedWhenTxClosed = -1;
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) => {
        const result = await run(prismaMock);
        billedWhenTxClosed = billed();
        return result;
      },
    );
    avatarCountMock.mockResolvedValue(0);

    await generateAvatars(2, "user-1");

    expect(serializableTransactionMock).toHaveBeenCalledTimes(1);
    expect(avatarCreateMock).toHaveBeenCalledTimes(2);
    expect(billedWhenTxClosed).toBe(0);
    expect(billed()).toBe(2);
  });

  it("hands back the slots it never spent on", async () => {
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" })
      .mockResolvedValueOnce({ id: "reserved-3" });
    generateTextMock.mockRejectedValue(new Error("gateway is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(generateAvatars(3)).resolves.toBe(0);
    } finally {
      error.mockRestore();
    }

    expect(avatarDeleteManyMock).toHaveBeenCalledWith({
      // The probe's row stays: the image model may already have billed for it.
      where: { id: { in: ["reserved-2", "reserved-3"] } },
    });
  });

  it("reports how many images it actually added", async () => {
    avatarCountMock.mockResolvedValue(0);
    avatarCreateMock
      .mockResolvedValueOnce({ id: "reserved-1" })
      .mockResolvedValueOnce({ id: "reserved-2" })
      .mockResolvedValueOnce({ id: "reserved-3" });
    // Probe succeeds, then one of the two remaining fills fails.
    avatarUpdateMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("blob rejected"))
      .mockResolvedValueOnce({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(generateAvatars(3)).resolves.toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("offers only original-style avatars, and only finished, unclaimed ones", async () => {
    await listAvailableAvatars(6);

    expect(avatarFindManyMock.mock.calls[0]?.[0].where).toEqual({
      claimedBySokoBotId: null,
      reservedAt: null,
      NOT: { background: { contains: ":" } },
    });
  });
  it("sweeps expired drafts and tombstones, never one a bot holds", async () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    avatarUpdateManyMock.mockResolvedValue({ count: 2 });
    avatarDeleteManyMock.mockResolvedValue({ count: 3 });

    await expect(sweepExpiredDrafts(now)).resolves.toBe(5);

    expect(avatarDeleteManyMock).toHaveBeenCalledWith({
      where: {
        claimedBySokoBotId: null,
        OR: [
          { draftExpiresAt: { lt: now } },
          // A kept look whose bot is gone has no expiry left to wait for.
          { draftForSokoBotId: { not: null }, draftExpiresAt: null },
        ],
      },
    });
  });

  it("sends a never-kept pool look back to the pool when its draft expires, before deleting the rest", async () => {
    const now = new Date("2026-09-11T12:00:00.000Z");

    await sweepExpiredDrafts(now);

    expect(avatarUpdateManyMock).toHaveBeenCalledWith({
      where: {
        claimedBySokoBotId: null,
        fromPool: true,
        // A kept look is never released to the pool.
        keptAt: null,
        draftExpiresAt: { lt: now },
      },
      data: { draftForSokoBotId: null, draftExpiresAt: null },
    });
    expect(avatarUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      avatarDeleteManyMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  describe("taking a pool look as a draft", () => {
    const expiresAt = new Date("2026-09-12T12:00:00.000Z");
    const look = (id: string) => ({
      id,
      imageUrl: `https://blob.test/${id}.webp`,
      look: { creature: "frog", accessories: [], typed: [] },
    });

    it("reserves an unclaimed current-style look for the bot", async () => {
      avatarFindManyMock.mockResolvedValue([look("pool-1")]);
      avatarUpdateManyMock.mockResolvedValue({ count: 1 });

      const taken = await takePoolLookAsDraft(
        "bot-1",
        expiresAt,
        CRAFTED_DESK_STYLE,
      );

      expect(taken?.id).toBe("pool-1");
      expect(avatarFindManyMock.mock.calls[0]?.[0].where).toMatchObject({
        claimedBySokoBotId: null,
        draftForSokoBotId: null,
        reservedAt: null,
        styleId: "crafted-desk",
      });
      // The claim repeats the pool filter, so a look another bot took first is not taken twice.
      expect(avatarUpdateManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "pool-1",
          draftForSokoBotId: null,
          claimedBySokoBotId: null,
        }),
        data: { draftForSokoBotId: "bot-1", draftExpiresAt: expiresAt },
      });
    });

    it("moves on to another look when one is lost to a race", async () => {
      avatarFindManyMock.mockResolvedValue([look("pool-1"), look("pool-2")]);
      avatarUpdateManyMock
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const taken = await takePoolLookAsDraft(
        "bot-1",
        expiresAt,
        CRAFTED_DESK_STYLE,
      );

      expect(taken).not.toBeNull();
      expect(avatarUpdateManyMock).toHaveBeenCalledTimes(2);
    });

    it("answers null when the pool is empty, so the caller draws fresh", async () => {
      avatarFindManyMock.mockResolvedValue([]);

      await expect(
        takePoolLookAsDraft("bot-1", expiresAt, CRAFTED_DESK_STYLE),
      ).resolves.toBeNull();
      expect(avatarUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  it("never counts or generates on a plain read", async () => {
    // The read is a GET. A GET that bills is reachable cross-site on a
    // top-level navigation, because the session cookie is SameSite=Lax.
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(6);

    expect(avatarCountMock).not.toHaveBeenCalled();
  });
});

describe("claiming a Soko Bot avatar", () => {
  const craftedDraft = {
    id: "draft-1",
    imageUrl: "https://blob.test/draft.webp",
    claimedBySokoBotId: null,
    reservedAt: null,
    styleId: "crafted-desk",
    keptAt: null,
    draftForSokoBotId: "bot-1",
    draftExpiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue(ENV);
    avatarUpdateManyMock.mockResolvedValue({ count: 1 });
    avatarDeleteManyMock.mockResolvedValue({ count: 0 });
    avatarFindManyMock.mockResolvedValue([]);
    avatarCountMock.mockResolvedValue(0);
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) => await run(prismaMock),
    );
  });

  it("refuses to hand a bot an avatar whose image is still in flight", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      imageUrl: "",
      reservedAt: new Date(),
    });

    await expect(claimAvatar("bot-1", "draft-1")).rejects.toThrow();

    expect(avatarUpdateManyMock).not.toHaveBeenCalled();
    expect(sokoBotUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps a draft: the bot takes the idle still and gets one render per state", async () => {
    avatarFindUniqueMock.mockResolvedValue(craftedDraft);

    await expect(
      claimAvatar("bot-1", "draft-1", {
        keptBy: "user-1",
        enforceKeepCap: true,
      }),
    ).resolves.toBe("https://blob.test/draft.webp");

    expect(sokoBotUpdateMock).toHaveBeenCalledWith({
      where: { id: "bot-1" },
      data: { avatarImageUrl: "https://blob.test/draft.webp" },
    });
    const { data } = renderCreateManyMock.mock.calls[0]?.[0] ?? {};
    expect(data.map((row: { state: string }) => row.state)).toEqual([
      "IDLE",
      "THINKING",
      "WORKING",
      "DONE",
      "NEEDS_YOU",
      "OFFLINE",
    ]);
    // The idle still is the look itself, so only the others wait on the cron.
    expect(
      data.filter((row: { status?: string }) => row.status === "STILL_READY"),
    ).toEqual([
      {
        avatarId: "draft-1",
        state: "IDLE",
        status: "STILL_READY",
        stillUrl: "https://blob.test/draft.webp",
      },
    ]);
    // Keeping a draft clears the bot's other drafts: one drawn for the bot is
    // deleted, a pool look goes back to the pool.
    const others = {
      draftForSokoBotId: "bot-1",
      claimedBySokoBotId: null,
      keptAt: null,
      id: { not: "draft-1" },
    };
    expect(avatarDeleteManyMock).toHaveBeenCalledWith({
      where: { ...others, fromPool: false },
    });
    expect(avatarUpdateManyMock).toHaveBeenCalledWith({
      where: { ...others, fromPool: true },
      data: { draftForSokoBotId: null, draftExpiresAt: null },
    });
    const claim = avatarUpdateManyMock.mock.calls.find(
      (call) => call[0].data.claimedBySokoBotId === "bot-1",
    )?.[0];
    expect(claim.data).toMatchObject({
      claimedBySokoBotId: "bot-1",
      keptAt: expect.any(Date),
      keptByUserId: "user-1",
      draftExpiresAt: null,
    });
  });

  it("stops a user at the daily keep cap before anything changes", async () => {
    avatarFindUniqueMock.mockResolvedValue(craftedDraft);
    avatarCountMock.mockResolvedValue(LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY);

    await expect(
      claimAvatar("bot-1", "draft-1", {
        keptBy: "user-1",
        enforceKeepCap: true,
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(avatarCountMock.mock.calls[0]?.[0].where).toMatchObject({
      keptByUserId: "user-1",
    });
    expect(sokoBotUpdateMock).not.toHaveBeenCalled();
    expect(renderCreateManyMock).not.toHaveBeenCalled();
  });

  it("does not charge staff a keep", async () => {
    avatarFindUniqueMock.mockResolvedValue(craftedDraft);
    avatarCountMock.mockResolvedValue(LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY);

    await expect(claimAvatar("bot-1", "draft-1")).resolves.toBeDefined();

    expect(avatarCountMock).not.toHaveBeenCalled();
  });

  it("does not re-count a look the bot already holds, so a double click keeps once", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      keptAt: new Date(),
      claimedBySokoBotId: "bot-1",
    });
    avatarCountMock.mockResolvedValue(LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY);

    await expect(
      claimAvatar("bot-1", "draft-1", {
        keptBy: "user-1",
        enforceKeepCap: true,
      }),
    ).resolves.toBeDefined();
  });

  it("retires the kept look a bot replaces: renders deleted, a tombstone for the cap window", async () => {
    avatarFindUniqueMock.mockResolvedValue(craftedDraft);
    avatarFindManyMock.mockResolvedValue([{ id: "old-1" }]);

    await claimAvatar("bot-1", "draft-1");

    expect(avatarFindManyMock.mock.calls[0]?.[0].where).toMatchObject({
      claimedBySokoBotId: "bot-1",
      keptAt: { not: null },
    });
    expect(renderDeleteManyMock).toHaveBeenCalledWith({
      where: { avatarId: { in: ["old-1"] } },
    });
    const retire = avatarUpdateManyMock.mock.calls[0]?.[0];
    expect(retire.where).toEqual({ id: { in: ["old-1"] } });
    expect(retire.data).toMatchObject({
      claimedBySokoBotId: null,
      draftForSokoBotId: "bot-1",
      draftExpiresAt: expect.any(Date),
    });
  });

  it("returns a look that was never kept to the pool, as before", async () => {
    avatarFindUniqueMock.mockResolvedValue(craftedDraft);

    await claimAvatar("bot-1", "draft-1");

    const release = avatarUpdateManyMock.mock.calls.find(
      (call) => call[0].where.keptAt === null && !call[0].where.fromPool,
    )?.[0];
    expect(release.where).toMatchObject({ claimedBySokoBotId: "bot-1" });
    expect(release.data).toEqual({ claimedBySokoBotId: null, claimedAt: null });
    expect(renderDeleteManyMock).not.toHaveBeenCalled();
  });

  it("will not hand a retired look back, so replacing is not a free undo", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      keptAt: new Date(),
      claimedBySokoBotId: null,
    });

    await expect(claimAvatar("bot-1", "draft-1")).rejects.toMatchObject({
      status: 404,
    });
    expect(renderCreateManyMock).not.toHaveBeenCalled();
  });

  it("records a keep that bot creation makes without ever refusing it", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      draftForSokoBotId: null,
      draftExpiresAt: null,
    });
    avatarCountMock.mockResolvedValue(LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY);

    await claimAvatar("bot-1", "draft-1", {
      tx: prismaMock,
      keptBy: "user-1",
    });

    // The cap is not consulted, but the keep counts toward tomorrow's.
    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(serializableTransactionMock).not.toHaveBeenCalled();
    const claim = avatarUpdateManyMock.mock.calls.find(
      (call) => call[0].data.claimedBySokoBotId === "bot-1",
    )?.[0];
    expect(claim.data).toMatchObject({
      keptAt: expect.any(Date),
      keptByUserId: "user-1",
    });
  });

  it("will not give a bot the draft of another bot", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      draftForSokoBotId: "bot-2",
    });

    await expect(claimAvatar("bot-1", "draft-1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("will not keep a draft that has expired", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      draftExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(claimAvatar("bot-1", "draft-1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("claims a legacy mascot as before: no renders, no keep", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      id: "mascot-1",
      styleId: "mascot",
      draftForSokoBotId: null,
      draftExpiresAt: null,
    });

    await claimAvatar("bot-1", "mascot-1", {
      keptBy: "user-1",
      enforceKeepCap: true,
    });

    expect(renderCreateManyMock).not.toHaveBeenCalled();
    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(
      avatarUpdateManyMock.mock.calls.find(
        (call) => call[0].data.claimedBySokoBotId === "bot-1",
      )?.[0].data,
    ).toEqual({
      claimedBySokoBotId: "bot-1",
      claimedAt: expect.any(Date),
    });
  });

  it("refuses an avatar another bot already holds", async () => {
    avatarFindUniqueMock.mockResolvedValue({
      ...craftedDraft,
      draftForSokoBotId: null,
      claimedBySokoBotId: "bot-2",
    });

    await expect(claimAvatar("bot-1", "draft-1")).rejects.toMatchObject({
      status: 422,
    });
  });
});
