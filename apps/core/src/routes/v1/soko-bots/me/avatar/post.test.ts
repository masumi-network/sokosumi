import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimAvatarMock, getStateMock } = vi.hoisted(() => ({
  claimAvatarMock: vi.fn(),
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

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

vi.mock("@/services/soko-bot-avatar.service", () => ({
  claimAvatar: claimAvatarMock,
  listAvailableAvatars: vi.fn(),
  topUpAvailableAvatars: vi.fn(),
}));

vi.mock("@/services/soko-bot-state.service", () => ({
  getSokoBotState: getStateMock,
  getSokoBotActivity: vi.fn(),
  listSharedSokoBots: vi.fn(),
}));

import { tooManyRequests } from "@/helpers/error";
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

describe("POST /me/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStateMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000099",
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Mine",
      avatarSeed: null,
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
    });
    claimAvatarMock.mockResolvedValue("https://blob.test/look.webp");
  });

  it("claims for the caller and spends their daily keep allowance", async () => {
    const response = await claim();

    expect(response.status).toBe(200);
    expect(claimAvatarMock).toHaveBeenCalledWith(
      "01960001-0001-7001-8001-000000000099",
      AVATAR_ID,
      { keptBy: USER_ID, enforceKeepCap: true },
    );
  });

  it("says 429 when the daily keep allowance is spent", async () => {
    claimAvatarMock.mockRejectedValue(
      tooManyRequests("You can keep at most 5 new looks per day.", {
        kind: "avatar_keep_rate_limited",
      }),
    );

    expect((await claim()).status).toBe(429);
  });
});
