import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The picker's two calls, with the database and the image model replaced
 * beside the route: what a user is offered, and what a top-up draws.
 */

const { store, drawMock, putMock } = vi.hoisted(() => ({
  store: {} as ReturnType<
    typeof import("@/test-fixtures/soko-bot-avatar-store").createSokoBotAvatarStore
  >,
  drawMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", async () => {
  const { createSokoBotAvatarStore } = await import(
    "@/test-fixtures/soko-bot-avatar-store"
  );
  Object.assign(store, createSokoBotAvatarStore());
  return { default: store.client };
});

// The image model: one fal POST per image; `drawMock` sees its URL and body.
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/fal-client")>()),
  downloadMedia: async () => ({
    bytes: new Uint8Array(drawnPng),
    contentType: "image/png",
  }),
}));
vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
  await drawMock({ url, body: JSON.parse(init.body) });
  return Response.json({
    images: [{ url: "https://v3.fal.media/files/avatar.png" }],
  });
});

vi.mock("@vercel/blob", () => ({ put: putMock }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      FAL_KEY: "fal-test",
      BLOB_READ_WRITE_TOKEN: "blob-test",
    }),
  };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

import { LIMITS } from "@/config/constants";
import { errorHandler } from "@/helpers/error-handler";
import { expectConsole } from "@/test/console";
import app from "./index";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_MODEL = "fal-ai/gemini-3.1-flash-image-preview";

function createApp() {
  const parent = new Hono<{
    Variables: RequestIdVariables & {
      authContext: {
        actor: "user";
        userId: string;
        organizationId: string | null;
        role: string;
      };
    };
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_avatars");
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

async function list(take = 6) {
  const response = await createApp().request(
    `http://localhost/avatars?take=${take}`,
  );
  return {
    status: response.status,
    ids: ((await response.json()).data as { id: string }[] | undefined)?.map(
      (one) => one.id,
    ),
  };
}

async function topUp(take = 6, excludeIds: string[] = [], fresh = false) {
  const response = await createApp().request(
    "http://localhost/avatars/top-up",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ take, excludeIds, fresh }),
    },
  );
  const body = await response.json();
  return {
    status: response.status,
    avatars: body.data as
      | { id: string; imageUrl: string; subject: string; background: string }[]
      | undefined,
    body,
  };
}

/** A real PNG, like the image model answers with. */
let drawnPng: Uint8Array;

describe("Soko Bot avatar picker", () => {
  beforeAll(async () => {
    drawnPng = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 150, g: 170, b: 140 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    store.reset();
    vi.clearAllMocks();
    drawMock.mockResolvedValue(undefined);
    putMock.mockImplementation(async (pathname: string) => ({
      url: `https://blob.test/${pathname}`,
    }));
  });

  describe("listing", () => {
    it("offers unused avatars only", async () => {
      const free = store.seed();
      store.seed({ claimedBySokoBotId: "bot-1", claimedAt: new Date() });
      store.seed({ reservedAt: new Date(), imageUrl: "" });

      await expect(list()).resolves.toEqual({ status: 200, ids: [free.id] });
    });

    it("never draws on a read", async () => {
      await expect(list()).resolves.toEqual({ status: 200, ids: [] });
      expect(drawMock).not.toHaveBeenCalled();
    });
  });

  describe("topping up", () => {
    it("draws the missing original-style avatars with the Gateway image model", async () => {
      store.seed();
      store.seed();

      const { status, avatars } = await topUp(6);

      expect(status).toBe(200);
      expect(avatars).toHaveLength(6);
      expect(drawMock).toHaveBeenCalledTimes(4);
      for (const [call] of drawMock.mock.calls) {
        expect(call.url).toBe(`https://fal.run/${IMAGE_MODEL}`);
        // The pre-#6710 recipe: one cute character emerging from a corner.
        expect(call.body.prompt).toContain(
          "Create one complete full-bleed 1:1 square image.",
        );
        expect(call.body.prompt).toContain("emerging from the lower-");
      }
      const drawn = store.avatars.filter((row) => row.requestedByUserId);
      expect(drawn).toHaveLength(4);
      for (const row of drawn) {
        expect(row.model).toBe(IMAGE_MODEL);
        expect(row.reservedAt).toBeNull();
        expect(row.imageUrl).toMatch(
          /^https:\/\/blob\.test\/soko-bots\/avatars\/original\/.+-[0-9a-f]{12}\.webp$/,
        );
        expect(row.background).not.toContain(":");
      }
    });

    it("stores each drawn avatar as a WebP under its own prefix", async () => {
      const { avatars } = await topUp(1);

      expect(avatars).toHaveLength(1);
      expect(putMock).toHaveBeenCalledTimes(1);
      const [pathname, body, options] = putMock.mock.calls[0]!;
      expect(pathname).toMatch(
        /^soko-bots\/avatars\/original\/.+-[0-9a-f]{12}\.webp$/,
      );
      expect(options.contentType).toBe("image/webp");
      const stored = await sharp(body).metadata();
      expect(stored.format).toBe("webp");
      expect([stored.width, stored.height]).toEqual([64, 64]);
      await expect(list()).resolves.toEqual({
        status: 200,
        ids: [avatars![0]!.id],
      });
    });

    it("leaves a stocked pool alone", async () => {
      for (let i = 0; i < 6; i += 1) store.seed();

      const { avatars } = await topUp(6);

      expect(avatars).toHaveLength(6);
      expect(drawMock).not.toHaveBeenCalled();
    });

    it("draws a refresh's shortfall before it answers", async () => {
      const seen = Array.from({ length: 4 }, () => store.seed().id);
      const unseen = [store.seed().id, store.seed().id];

      const { status, avatars } = await topUp(6, seen);

      expect(status).toBe(200);
      expect(drawMock).toHaveBeenCalledTimes(4);
      expect(avatars).toHaveLength(6);
      expect(avatars?.some((one) => seen.includes(one.id))).toBe(false);
      expect(avatars?.map((one) => one.id)).toEqual(
        expect.arrayContaining(unseen),
      );
    });

    it("draws a new set for Show others even when the pool is stocked", async () => {
      const stocked = Array.from({ length: 30 }, () => store.seed().id);

      const { status, avatars } = await topUp(6, [], true);

      expect(status).toBe(200);
      expect(drawMock).toHaveBeenCalledTimes(6);
      expect(avatars).toHaveLength(6);
      expect(avatars?.some((one) => stocked.includes(one.id))).toBe(false);
      expect(store.avatars.every((row) => row.reservedAt === null)).toBe(true);
    });

    it("answers Show others with nothing when its paid draw could not be stored", async () => {
      store.seed();
      // Quiet the failure's log line; the outcome is what is checked.
      expectConsole(
        "error",
        "Soko Bot avatar generation failed; skipping this run",
      );
      putMock.mockRejectedValue(new Error("blob down"));

      const { status, avatars } = await topUp(6, [], true);

      // A 200: a draw was tried and may have been billed, so it is a spent try.
      expect(status).toBe(200);
      expect(avatars).toEqual([]);
      expect(drawMock).toHaveBeenCalledTimes(1);
    });

    it("answers 409 and buys nothing while the user's own draw is in flight", async () => {
      let release: () => void = () => {};
      const drawing = new Promise<void>((resolve) => {
        release = resolve;
      });
      drawMock.mockImplementation(async () => {
        await drawing;
      });

      const first = topUp(6, [], true);
      await vi.waitFor(() => expect(drawMock).toHaveBeenCalled());
      const second = await topUp(6, [], true);
      release();

      expect(second.status).toBe(409);
      expect(second.body.kind).toBe("avatar_draw_busy");
      expect((await first).avatars).toHaveLength(6);
      expect(drawMock).toHaveBeenCalledTimes(6);
    });

    it("answers Show others 429 once the hourly allowance is spent", async () => {
      for (let i = 0; i < LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR; i += 1) {
        store.seed({ requestedByUserId: USER_ID, claimedBySokoBotId: `b${i}` });
      }
      store.seed();

      const { status, body } = await topUp(6, [], true);

      expect(status).toBe(429);
      expect(body.kind).toBe("avatar_generation_rate_limited");
      expect(drawMock).not.toHaveBeenCalled();
    });

    it("keeps concurrent Show others draws under the hourly cap", async () => {
      // Two left of the allowance, and three refreshes each asking for six.
      for (
        let i = 0;
        i < LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR - 2;
        i += 1
      ) {
        store.seed({ requestedByUserId: USER_ID, claimedBySokoBotId: `b${i}` });
      }

      await Promise.all([
        topUp(6, [], true),
        topUp(6, [], true),
        topUp(6, [], true),
      ]);

      expect(drawMock).toHaveBeenCalledTimes(2);
    });

    it("waits for a first open to be drawn when the pool is short", async () => {
      store.seed();

      const { status, avatars } = await topUp(6);

      expect(status).toBe(200);
      expect(avatars).toHaveLength(6);
      expect(drawMock).toHaveBeenCalledTimes(5);
      // Drawn before the answer: nothing is left in flight behind it.
      expect(store.avatars.every((row) => row.reservedAt === null)).toBe(true);
    });

    it("draws only what is left of the user's hourly allowance", async () => {
      for (
        let i = 0;
        i < LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR - 2;
        i += 1
      ) {
        store.seed({ requestedByUserId: USER_ID, claimedBySokoBotId: `b${i}` });
      }

      const { status, avatars } = await topUp(6);

      expect(status).toBe(200);
      expect(drawMock).toHaveBeenCalledTimes(2);
      expect(avatars).toHaveLength(2);
    });

    it("answers 429 once the user has drawn 24 this hour and nothing is left", async () => {
      expect(LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR).toBe(24);
      for (let i = 0; i < 24; i += 1) {
        store.seed({ requestedByUserId: USER_ID, claimedBySokoBotId: `b${i}` });
      }

      const { status, body } = await topUp(6);

      expect(status).toBe(429);
      expect(body.kind).toBe("avatar_generation_rate_limited");
      expect(drawMock).not.toHaveBeenCalled();
    });

    it("forgets draws older than an hour", async () => {
      const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (let i = 0; i < 24; i += 1) {
        store.seed({
          requestedByUserId: USER_ID,
          claimedBySokoBotId: `b${i}`,
          createdAt: longAgo,
        });
      }

      const { status, avatars } = await topUp(6);

      expect(status).toBe(200);
      expect(avatars).toHaveLength(6);
    });
  });
});
