import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStateMock, memberFindFirstMock, resolveMock, updateManyMock } =
  vi.hoisted(() => ({
    getStateMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
    resolveMock: vi.fn(),
    updateManyMock: vi.fn(),
  }));

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const BOT_ID = "01960001-0001-7001-8001-000000000099";

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

vi.mock("@/helpers/soko-bot-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/soko-bot-resolver")>();
  return { ...actual, memberSokoBot: resolveMock };
});

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: false }),
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/services/soko-bot-state.service", () => ({
  getSokoBotState: getStateMock,
  getSokoBotActivity: vi.fn(),
  listSharedSokoBots: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { updateMany: updateManyMock },
    member: { findFirst: memberFindFirstMock },
  },
}));

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "../../index";

function put(path: string, body: unknown) {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_rename");
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
      organizationId: "org_1",
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent.request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NOW = new Date("2026-11-09T10:00:00.000Z");

function botState(name: string, userId: string | null) {
  return {
    id: BOT_ID,
    userId,
    workspaceId: WORKSPACE_ID,
    projectId: null,
    viewerCanManage: true,
    name,
    avatarSeed: null,
    personalityTone: null,
    personalityDetail: null,
    personalityStyle: null,
    status: "IDLE",
    runtimeVersion: null,
    lastSandboxStatus: null,
    memoryVersion: 1,
    memoryHash: null,
    lastActivityAt: null,
    lastTurnAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveTurnFailures: 0,
    memoryRevisions: [],
    legacyMessages: [],
    pendingDecisions: [],
    schedules: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("PUT /me/name and /{sokoBotId}/name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it("renames the owner's bot with the trimmed name", async () => {
    resolveMock.mockResolvedValue({
      id: BOT_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    getStateMock.mockResolvedValue(botState("Atlas", USER_ID));

    const response = await put("/me/name", { name: "  Atlas  " });

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: BOT_ID, archivedAt: null },
      data: { name: "Atlas" },
    });
    expect((await response.json()).data.name).toBe("Atlas");
  });

  it.each([
    ["blank", "   "],
    ["too long", "x".repeat(81)],
  ])("refuses a %s name without writing", async (_label, name) => {
    resolveMock.mockResolvedValue({
      id: BOT_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const response = await put("/me/name", { name });

    expect(response.status).toBe(422);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's personal bot by id", async () => {
    // The resolver hides another member's personal bot like a missing one.
    resolveMock.mockResolvedValue(null);

    const response = await put(`/${BOT_ID}/name`, { name: "Mine now" });

    expect(response.status).toBe(404);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("refuses a plain member renaming a shared bot", async () => {
    resolveMock.mockResolvedValue({
      id: BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
    });
    memberFindFirstMock.mockResolvedValue({ role: "member" });

    const response = await put(`/${BOT_ID}/name`, { name: "Team bot 2" });

    expect(response.status).toBe(403);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("lets an organization admin rename a shared bot", async () => {
    resolveMock.mockResolvedValue({
      id: BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
    });
    memberFindFirstMock.mockResolvedValue({ role: "admin" });
    getStateMock.mockResolvedValue(botState("Team bot 2", null));

    const response = await put(`/${BOT_ID}/name`, { name: "Team bot 2" });

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: BOT_ID, archivedAt: null },
      data: { name: "Team bot 2" },
    });
    expect(getStateMock).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, {
      kind: "id",
      sokoBotId: BOT_ID,
    });
  });

  it("answers 404 when the bot was archived meanwhile", async () => {
    resolveMock.mockResolvedValue({
      id: BOT_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    updateManyMock.mockResolvedValue({ count: 0 });

    const response = await put("/me/name", { name: "Atlas" });

    expect(response.status).toBe(404);
  });
});
