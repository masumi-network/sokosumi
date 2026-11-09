import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, getStateMock } = vi.hoisted(() => ({
  store: {} as ReturnType<
    typeof import("@/test-fixtures/soko-bot-avatar-store").createSokoBotAvatarStore
  >,
  getStateMock: vi.fn(),
}));

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const AVATAR_ID = "01960001-0001-7001-8001-0000000000aa";

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), SOKO_BOT_ENABLED: true }),
  };
});

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    await next(),
}));

vi.mock("@/middleware/organization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/organization")>();
  return {
    ...actual,
    organizationContextMiddleware: async (
      _c: unknown,
      next: () => Promise<void>,
    ) => await next(),
  };
});

vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    workspaceMiddleware: () => async (_c: unknown, next: () => Promise<void>) =>
      await next(),
  };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/lib/db/prisma", async () => {
  const { createSokoBotAvatarStore } = await import(
    "@/test-fixtures/soko-bot-avatar-store"
  );
  Object.assign(store, createSokoBotAvatarStore());
  return { default: store.client };
});

vi.mock("@/services/soko-bot-state.service", () => ({
  getSokoBotState: getStateMock,
  getSokoBotActivity: vi.fn(),
  listSharedSokoBots: vi.fn(),
}));

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "../../index";

function createApp() {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_claim_avatar");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

const NOW = new Date("2026-10-29T12:00:00.000Z");

function claim() {
  return createApp().request("http://localhost/me/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avatarId: AVATAR_ID }),
  });
}

const BOT_ID = "01960001-0001-7001-8001-000000000099";

describe("POST /me/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
    // The bot as the state read sees it, with whatever avatar the claim wrote.
    getStateMock.mockImplementation(async () => ({
      id: BOT_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Mine",
      avatarSeed: null,
      avatarImageUrl:
        (store.bots.get(BOT_ID)?.avatarImageUrl as string | undefined) ?? null,
      personalityTone: null,
      personalityDetail: null,
      personalityStyle: null,
      status: "IDLE",
      runtimeVersion: null,
      lastSandboxStatus: null,
      memoryVersion: 0,
      memoryHash: null,
      lastActivityAt: null,
      lastTurnAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveTurnFailures: 0,
      memoryRevisions: [],
      createdAt: NOW,
      updatedAt: NOW,
    }));
  });

  it("gives the bot the picked avatar and shows its picture", async () => {
    store.seed({ id: AVATAR_ID, imageUrl: "https://blob.test/owl-1.png" });

    const response = await claim();

    expect(response.status).toBe(200);
    expect((await response.json()).data.avatarImageUrl).toBe(
      "https://blob.test/owl-1.png",
    );
    expect(store.avatars[0]?.claimedBySokoBotId).toBe(BOT_ID);
  });

  it("puts the previous avatar back in the pool when the bot changes it", async () => {
    const previous = store.seed({
      imageUrl: "https://blob.test/fox-1.png",
      claimedBySokoBotId: BOT_ID,
      claimedAt: NOW,
    });
    store.bots.set(BOT_ID, { avatarImageUrl: previous.imageUrl });
    store.seed({ id: AVATAR_ID, imageUrl: "https://blob.test/owl-1.png" });

    const response = await claim();

    expect((await response.json()).data.avatarImageUrl).toBe(
      "https://blob.test/owl-1.png",
    );
    expect(previous.claimedBySokoBotId).toBeNull();
  });

  it("refuses an avatar another bot already holds", async () => {
    store.seed({ id: AVATAR_ID, claimedBySokoBotId: "other-bot" });

    expect((await claim()).status).toBe(422);
    expect(store.bots.has(BOT_ID)).toBe(false);
  });

  it("refuses an avatar whose picture is still being drawn", async () => {
    store.seed({ id: AVATAR_ID, imageUrl: "", reservedAt: NOW });

    expect((await claim()).status).toBe(404);
  });
});
