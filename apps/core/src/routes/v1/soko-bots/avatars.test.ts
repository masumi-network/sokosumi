import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The picker's two calls, with the database and the image model replaced
 * beside the route: what a user is offered, and what a top-up draws.
 */

const { store, generateTextMock, putMock } = vi.hoisted(() => ({
  store: {} as ReturnType<
    typeof import("@/test-fixtures/soko-bot-avatar-store").createSokoBotAvatarStore
  >,
  generateTextMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", async () => {
  const { createSokoBotAvatarStore } = await import(
    "@/test-fixtures/soko-bot-avatar-store"
  );
  Object.assign(store, createSokoBotAvatarStore());
  return { default: store.client };
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: generateTextMock,
}));

vi.mock("@vercel/blob", () => ({ put: putMock }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      AI_GATEWAY_API_KEY: "gateway-test",
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

import app from "./index";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_MODEL = "google/gemini-3.1-flash-image";

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

async function topUp(take = 6, excludeIds: string[] = []) {
  const response = await createApp().request(
    "http://localhost/avatars/top-up",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ take, excludeIds }),
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

/** A crafted-style row as #6710 wrote it: background `<style>:<accessories>`, a WebP. */
function seedCrafted(row: Record<string, unknown> = {}) {
  return store.seed({
    subject: "otter",
    background: "crafted-desk:none",
    imageUrl: "https://blob.test/otter-1.webp",
    ...row,
  });
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
    generateTextMock.mockImplementation(async () => ({
      files: [{ mediaType: "image/png", uint8Array: drawnPng }],
    }));
    putMock.mockImplementation(async (pathname: string) => ({
      url: `https://blob.test/${pathname}`,
    }));
  });

  describe("listing", () => {
    it("offers unused original-style avatars and never a crafted one", async () => {
      const free = store.seed();
      store.seed({ claimedBySokoBotId: "bot-1", claimedAt: new Date() });
      store.seed({ reservedAt: new Date(), imageUrl: "" });
      seedCrafted();
      seedCrafted({ background: "crafted-desk:scarf", subject: "frog" });

      await expect(list()).resolves.toEqual({ status: 200, ids: [free.id] });
    });

    it("offers again an original-style avatar a crafted pick released", async () => {
      // Picking a crafted-style avatar cleared the claim on the bot's old avatar.
      const released = store.seed({
        claimedBySokoBotId: null,
        claimedAt: null,
      });
      seedCrafted({ claimedBySokoBotId: "bot-1", claimedAt: new Date() });

      await expect(list()).resolves.toEqual({
        status: 200,
        ids: [released.id],
      });
    });

    it("never draws on a read", async () => {
      await expect(list()).resolves.toEqual({ status: 200, ids: [] });
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });

  describe("topping up", () => {
    it("draws the missing original-style avatars with the Gateway image model", async () => {
      store.seed();
      store.seed();

      const { status, avatars } = await topUp(6);

      expect(status).toBe(200);
      expect(avatars).toHaveLength(6);
      expect(generateTextMock).toHaveBeenCalledTimes(4);
      for (const [call] of generateTextMock.mock.calls) {
        expect(call.model.modelId).toBe(IMAGE_MODEL);
        // The pre-#6710 recipe: one cute character emerging from a corner.
        expect(call.prompt).toContain(
          "Create one complete full-bleed 1:1 square image.",
        );
        expect(call.prompt).toContain("emerging from the lower-");
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
      // A new original-style avatar is offered, not hidden as a crafted one.
      await expect(list()).resolves.toEqual({
        status: 200,
        ids: [avatars![0]!.id],
      });
    });

    it("does not count crafted-style avatars as stock", async () => {
      for (let i = 0; i < 6; i += 1) seedCrafted({ seed: i + 1 });

      const { avatars } = await topUp(6);

      expect(generateTextMock).toHaveBeenCalledTimes(6);
      expect(avatars?.every((one) => !one.background.includes(":"))).toBe(true);
    });

    it("leaves a stocked pool alone", async () => {
      for (let i = 0; i < 6; i += 1) store.seed();

      const { avatars } = await topUp(6);

      expect(avatars).toHaveLength(6);
      expect(generateTextMock).not.toHaveBeenCalled();
    });

    it("draws new avatars when the user has seen the whole pool", async () => {
      const seen = Array.from({ length: 6 }, () => store.seed().id);

      const { status, avatars } = await topUp(6, seen);

      expect(status).toBe(200);
      expect(generateTextMock).toHaveBeenCalledTimes(6);
      expect(avatars).toHaveLength(6);
      expect(avatars?.some((one) => seen.includes(one.id))).toBe(false);
    });

    it("draws only the unseen avatars the pool is short of", async () => {
      const seen = Array.from({ length: 4 }, () => store.seed().id);
      store.seed();
      store.seed();

      const { avatars } = await topUp(6, seen);

      expect(generateTextMock).toHaveBeenCalledTimes(4);
      expect(avatars).toHaveLength(6);
      expect(avatars?.some((one) => seen.includes(one.id))).toBe(false);
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
      expect(generateTextMock).toHaveBeenCalledTimes(2);
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
      expect(generateTextMock).not.toHaveBeenCalled();
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
