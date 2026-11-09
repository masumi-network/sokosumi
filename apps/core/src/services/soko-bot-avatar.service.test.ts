import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the pool does that the avatar routes cannot easily show: how a failed
 * or raced run settles, and what the hourly cap counts. The database is the
 * in-memory store, the image model and blob store are replaced.
 */

const { store, generateTextMock, getEnvMock, putMock } = vi.hoisted(() => ({
  store: {} as ReturnType<
    typeof import("@/test-fixtures/soko-bot-avatar-store").createSokoBotAvatarStore
  >,
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
vi.mock("@/lib/db/prisma", async () => {
  const { createSokoBotAvatarStore } = await import(
    "@/test-fixtures/soko-bot-avatar-store"
  );
  Object.assign(store, createSokoBotAvatarStore());
  return { default: store.client };
});

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import {
  claimAvatar,
  generateAvatars,
  listAvailableAvatars,
  topUpAvailableAvatars,
} from "@/services/soko-bot-avatar.service";

const IMAGE_BYTES = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "#9aa88c" },
})
  .png()
  .toBuffer();

/** What the image model answers: one PNG among its files. */
function imageAnswer() {
  return { files: [{ mediaType: "image/png", uint8Array: IMAGE_BYTES }] };
}

/** How many images were bought. */
function billed() {
  return generateTextMock.mock.calls.length;
}

const ENV = { AI_GATEWAY_API_KEY: "gw-test", BLOB_READ_WRITE_TOKEN: "token" };
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

function raceLost() {
  return new HTTPException(409, {
    message: "Another avatar top-up is running. Try again.",
    cause: { kind: CONCURRENCY_CONFLICT_KIND },
  });
}

/** Rows a user drew, already claimed so they do not stock the pool. */
function seedDrawnBy(userId: string, count: number, createdAt = new Date()) {
  for (let i = 0; i < count; i += 1) {
    store.seed({
      requestedByUserId: userId,
      claimedBySokoBotId: `${userId}-bot-${createdAt.getTime()}-${i}`,
      createdAt,
    });
  }
}

beforeEach(() => {
  store.reset();
  vi.clearAllMocks();
  getEnvMock.mockReturnValue(ENV);
  generateTextMock.mockResolvedValue(imageAnswer());
  putMock.mockImplementation(async (pathname: string) => ({
    url: `https://blob.test/${pathname}`,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Soko Bot avatar pool", () => {
  it("serves the pool and buys nothing without a gateway key or blob store", async () => {
    getEnvMock.mockReturnValue({});
    const stocked = store.seed();

    const avatars = await topUpAvailableAvatars(6, {
      requestedByUserId: "user-1",
    });

    expect(avatars.map((one) => one.id)).toEqual([stocked.id]);
    expect(billed()).toBe(0);
  });

  it("buys one image, not six, when storing them is broken", async () => {
    // The image model bills for an image whether or not we store it. With a
    // broken blob token the pool never fills, so an ungated run would buy six
    // on every top-up while writing nothing louder than a warning.
    putMock.mockRejectedValue(new Error("blob token rejected"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(generateAvatars(6, "user-1")).resolves.toBe(0);

    expect(billed()).toBe(1);
  });

  it("hands back the slots it never spent on, and keeps the one it may have paid for", async () => {
    generateTextMock.mockRejectedValue(new Error("gateway is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(generateAvatars(3, "user-1")).resolves.toBe(0);

    // The probe's row stays: the image model may already have billed for it,
    // and the cap should see it. It is still reserved, so nobody is offered it.
    expect(store.avatars).toHaveLength(1);
    expect(store.avatars[0]?.reservedAt).toBeInstanceOf(Date);
    await expect(listAvailableAvatars(6)).resolves.toEqual([]);
  });

  it("survives a release that fails instead of raising a 500", async () => {
    vi.spyOn(store.client.sokoBotAvatar, "deleteMany").mockRejectedValue(
      new Error("pool exhausted"),
    );
    generateTextMock.mockRejectedValue(new Error("gateway is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(generateAvatars(2, "user-1")).resolves.toBe(0);
  });

  it("reports how many images it actually added", async () => {
    // Probe succeeds, then one of the two remaining fills fails.
    putMock
      .mockImplementationOnce(async (pathname: string) => ({
        url: `https://blob.test/${pathname}`,
      }))
      .mockRejectedValueOnce(new Error("blob rejected"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(generateAvatars(3, "user-1")).resolves.toBe(2);
    await expect(listAvailableAvatars(6)).resolves.toHaveLength(2);
  });

  it("holds the draw before it buys the image, and never buys inside the transaction", async () => {
    // A row written only after the paid call lets concurrent requests all
    // read the same count and all pass the cap. A paid call inside the
    // transaction would hold it open on the image model.
    let insideTransaction = false;
    const transaction = store.client.$transaction;
    vi.spyOn(store.client, "$transaction").mockImplementation(async (run) => {
      insideTransaction = true;
      try {
        return await transaction(run);
      } finally {
        insideTransaction = false;
      }
    });
    let seenWhileBuying: { reserved: number; offered: number } | undefined;
    generateTextMock.mockImplementation(async () => {
      expect(insideTransaction).toBe(false);
      seenWhileBuying = {
        reserved: store.avatars.filter((row) => row.reservedAt).length,
        offered: (await listAvailableAvatars(6)).length,
      };
      return imageAnswer();
    });

    const avatars = await topUpAvailableAvatars(1, {
      requestedByUserId: "user-1",
    });

    // While the image was bought its row existed, held and not offered.
    expect(seenWhileBuying).toEqual({ reserved: 1, offered: 0 });
    // Once stored, the same row is published with its image.
    expect(avatars).toHaveLength(1);
    expect(store.avatars).toHaveLength(1);
    expect(store.avatars[0]?.reservedAt).toBeNull();
    expect(store.avatars[0]?.imageUrl).toBe(avatars[0]?.imageUrl);
  });

  it("serves the pool when a concurrent top-up wins the race", async () => {
    // A lost serialization race surfaces as a retryable 409. It says nothing
    // about the rows already in the pool, so answering with an error would
    // blank a picker that had avatars to show.
    const stocked = store.seed();
    vi.spyOn(store.client, "$transaction").mockRejectedValue(raceLost());

    const avatars = await topUpAvailableAvatars(6, {
      requestedByUserId: "user-1",
    });

    expect(avatars.map((one) => one.id)).toEqual([stocked.id]);
  });

  it("still reports the race when the pool has nothing to fall back on", async () => {
    const conflictError = raceLost();
    vi.spyOn(store.client, "$transaction").mockRejectedValue(conflictError);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toBe(conflictError);
  });

  it("does not swallow a genuine fault as if it were a lost race", async () => {
    store.seed();
    const fault = new Error("prisma is down");
    vi.spyOn(store.client, "$transaction").mockRejectedValue(fault);

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).rejects.toBe(fault);
  });

  it("still serves the pool to a capped user rather than only a 429", async () => {
    seedDrawnBy("user-1", LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR);
    store.seed();
    store.seed();

    await expect(
      topUpAvailableAvatars(6, { requestedByUserId: "user-1" }),
    ).resolves.toHaveLength(2);
    expect(billed()).toBe(0);
  });

  it("counts exactly the last hour, and only that user's rows", async () => {
    // An all-time count would lock a user out for ever; a 1 ms window would
    // make the cap unreachable.
    const cap = LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR;
    seedDrawnBy("user-1", cap - 2, minutesAgo(59));
    seedDrawnBy("user-1", 5, minutesAgo(61));
    seedDrawnBy("user-2", 10);

    await topUpAvailableAvatars(6, { requestedByUserId: "user-1" });

    expect(billed()).toBe(2);
  });

  it("sweeps dead reservations when it tops up, the only place that does", async () => {
    // There is no cron. Without this the row of a run that died holds its
    // draw and the user's allowance for ever. Aged off `createdAt`, the same
    // column the cap reads, so sweeping never returns allowance early.
    const dead = store.seed({
      imageUrl: "",
      reservedAt: new Date(Date.now() - 2 * HOUR_MS),
      createdAt: new Date(Date.now() - 2 * HOUR_MS),
    });
    const inFlight = store.seed({
      imageUrl: "",
      reservedAt: minutesAgo(30),
      createdAt: minutesAgo(30),
    });

    await topUpAvailableAvatars(1, { requestedByUserId: "user-1" });

    const ids = store.avatars.map((row) => row.id);
    expect(ids).not.toContain(dead.id);
    expect(ids).toContain(inFlight.id);
  });
});

describe("claiming a Soko Bot avatar", () => {
  const BOT_ID = "bot-1";

  beforeEach(() => {
    store.bots.set(BOT_ID, { avatarImageUrl: null });
  });

  it("gives the bot the avatar's picture and returns its previous one to the pool", async () => {
    const previous = store.seed({ claimedBySokoBotId: BOT_ID });
    const picked = store.seed({ imageUrl: "https://blob.test/frog-1.webp" });

    await expect(claimAvatar(BOT_ID, picked.id)).resolves.toBe(
      "https://blob.test/frog-1.webp",
    );

    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBe(
      "https://blob.test/frog-1.webp",
    );
    const offered = await listAvailableAvatars(6);
    expect(offered.map((one) => one.id)).toEqual([previous.id]);
  });

  it("works inside the caller's transaction when bot creation passes one", async () => {
    const picked = store.seed();
    // Opening a transaction of its own would fail here.
    vi.spyOn(store.client, "$transaction").mockRejectedValue(
      new Error("nested transaction"),
    );

    await claimAvatar(BOT_ID, picked.id, store.client as never);

    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBe(picked.imageUrl);
  });

  it("refuses when another bot takes it first", async () => {
    // Another bot's claim lands between the read and the write.
    const picked = store.seed({ claimedBySokoBotId: "bot-2" });
    const findUnique = store.client.sokoBotAvatar.findUnique;
    vi.spyOn(store.client.sokoBotAvatar, "findUnique").mockImplementationOnce(
      async (args) => ({
        ...(await findUnique(args)),
        claimedBySokoBotId: null,
      }),
    );

    await expect(claimAvatar(BOT_ID, picked.id)).rejects.toMatchObject({
      status: 422,
    });
    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBeNull();
    expect(store.avatars[0]?.claimedBySokoBotId).toBe("bot-2");
  });
});
