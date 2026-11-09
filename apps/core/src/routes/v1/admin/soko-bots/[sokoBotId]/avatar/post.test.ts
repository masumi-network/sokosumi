import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An admin sets any bot's avatar from the shared pool, with the database
 * replaced beside the route: what the bot shows and what goes back to the pool.
 */

const { authRole, store } = vi.hoisted(() => ({
  authRole: { value: "admin" as string | null },
  store: {} as ReturnType<
    typeof import("@/test-fixtures/soko-bot-avatar-store").createSokoBotAvatarStore
  >,
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role: authRole.value,
      });
      await next();
    },
  };
});

vi.mock("@/lib/db/prisma", async () => {
  const { createSokoBotAvatarStore } = await import(
    "@/test-fixtures/soko-bot-avatar-store"
  );
  Object.assign(store, createSokoBotAvatarStore());
  return { default: store.client };
});

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mount from "./post";

const app = new OpenAPIHonoWithAuth();
mount(app);

const BOT_ID = "01a04a27-255e-7798-8fba-6f55fe79d132";
const AVATAR_ID = "01a04a27-255e-7798-8fba-6f55fe79d133";
const NOW = new Date("2026-11-09T12:00:00.000Z");

function post() {
  return app.request(`http://localhost/${BOT_ID}/avatar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avatarId: AVATAR_ID }),
  });
}

describe("POST /admin/soko-bots/{sokoBotId}/avatar", () => {
  beforeEach(() => {
    store.reset();
    authRole.value = "admin";
    store.bots.set(BOT_ID, { avatarImageUrl: null, deletedAt: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("gives the bot the picked avatar and shows its picture", async () => {
    store.seed({ id: AVATAR_ID, imageUrl: "https://blob.test/owl-1.png" });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { avatarImageUrl: "https://blob.test/owl-1.png" },
    });
    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBe(
      "https://blob.test/owl-1.png",
    );
    expect(store.avatars[0]?.claimedBySokoBotId).toBe(BOT_ID);
  });

  it("puts the previous avatar back in the pool", async () => {
    const previous = store.seed({
      imageUrl: "https://blob.test/fox-1.png",
      claimedBySokoBotId: BOT_ID,
      claimedAt: NOW,
    });
    store.bots.set(BOT_ID, {
      avatarImageUrl: previous.imageUrl,
      deletedAt: null,
    });
    store.seed({ id: AVATAR_ID, imageUrl: "https://blob.test/owl-1.png" });

    expect((await post()).status).toBe(200);
    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBe(
      "https://blob.test/owl-1.png",
    );
    expect(previous.claimedBySokoBotId).toBeNull();
    expect(previous.claimedAt).toBeNull();
  });

  it("refuses an avatar another bot already holds", async () => {
    store.seed({ id: AVATAR_ID, claimedBySokoBotId: "other-bot" });

    expect((await post()).status).toBe(422);
    expect(store.bots.get(BOT_ID)?.avatarImageUrl).toBeNull();
  });

  it("refuses a non-admin", async () => {
    authRole.value = null;
    store.seed({ id: AVATAR_ID });

    expect((await post()).status).toBe(403);
    expect(store.avatars[0]?.claimedBySokoBotId).toBeNull();
  });

  it("404s an unknown bot", async () => {
    store.bots.clear();
    store.seed({ id: AVATAR_ID });

    expect((await post()).status).toBe(404);
    expect(store.avatars[0]?.claimedBySokoBotId).toBeNull();
  });

  it("404s a deleted bot", async () => {
    store.bots.set(BOT_ID, { avatarImageUrl: null, deletedAt: NOW });
    store.seed({ id: AVATAR_ID });

    expect((await post()).status).toBe(404);
    expect(store.avatars[0]?.claimedBySokoBotId).toBeNull();
  });

  it("answers 409 when concurrent changes keep winning the race", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    store.seed({ id: AVATAR_ID });
    vi.spyOn(store.client, "$transaction").mockRejectedValue(
      Object.assign(new Error("write conflict"), { code: "P2034" }),
    );

    const pending = post();
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(409);
  });
});
