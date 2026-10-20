import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  archiveMock,
  cancelTurnMock,
  createSharedMock,
  decisionFindFirstMock,
  getStateMock,
  listSharedMock,
  listTurnsMock,
  personalCreateMock,
  reactivateMock,
  resolveDecisionMock,
  resolveMock,
  turnFindFirstMock,
} = vi.hoisted(() => ({
  archiveMock: vi.fn(),
  cancelTurnMock: vi.fn(),
  createSharedMock: vi.fn(),
  decisionFindFirstMock: vi.fn(),
  getStateMock: vi.fn(),
  listSharedMock: vi.fn(),
  listTurnsMock: vi.fn(),
  personalCreateMock: vi.fn(),
  reactivateMock: vi.fn(),
  resolveDecisionMock: vi.fn(),
  resolveMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
}));

const USER_ID = "user_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";
const BOT_ID = "01960001-0001-7001-8001-000000000099";
const PROJECT_ID = "01960001-0001-7001-8001-000000000077";
const TURN_ID = "01960001-0001-7001-8001-000000000055";
const DECISION_ID = "01960001-0001-7001-8001-000000000066";

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      SOKO_BOT_ENABLED: true,
    }),
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
  listSharedSokoBots: listSharedMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findFirst: turnFindFirstMock },
    sokoBotPendingDecision: { findFirst: decisionFindFirstMock },
  },
}));

vi.mock("@/services/soko-bot-runtime.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-runtime.service")
    >();
  return {
    ...actual,
    sokoBotRuntimeService: { resolveDecision: resolveDecisionMock },
  };
});

vi.mock("@/services/soko-bot-shared-create.service", () => ({
  createSharedSokoBot: createSharedMock,
  reactivateSharedSokoBot: reactivateMock,
}));

vi.mock("@/services/soko-bot-control-plane.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-control-plane.service")
    >();
  return {
    ...actual,
    sokoBotControlPlane: {
      ...actual.sokoBotControlPlane,
      archive: archiveMock,
      cancelTurn: cancelTurnMock,
      create: personalCreateMock,
      listTurns: listTurnsMock,
    },
  };
});

import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import app from "./index";

function createApp() {
  const parent = new Hono<{
    Variables: EnvVariables["Variables"] & RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_shared_routes");
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
  return parent;
}

const NOW = new Date("2026-10-14T10:00:00.000Z");

function botState(overrides: Record<string, unknown> = {}) {
  return {
    id: BOT_ID,
    userId: null,
    workspaceId: WORKSPACE_ID,
    projectId: null,
    viewerCanManage: false,
    name: "Team bot",
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
    ...overrides,
  };
}

function post(path: string, body?: unknown) {
  return createApp().request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("shared Soko Bot routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStateMock.mockResolvedValue(botState());
    listSharedMock.mockResolvedValue([]);
    resolveMock.mockResolvedValue({ id: BOT_ID, userId: null });
  });

  describe("with no shared bots setting", () => {
    it("still creates a personal bot", async () => {
      personalCreateMock.mockResolvedValue({ id: BOT_ID });
      getStateMock.mockResolvedValue(botState({ userId: USER_ID }));

      const response = await post("/", { scope: "personal", name: "Mine" });

      expect(response.status).toBe(201);
      expect(personalCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, workspaceId: WORKSPACE_ID }),
      );
    });

    it("rejects a sokoBotId that is not a uuid", async () => {
      const response = await createApp().request("http://localhost/not-a-uuid");

      expect(response.status).toBe(422);
      expect(getStateMock).not.toHaveBeenCalled();
    });

    it("reads a bot by id with viewerCanManage", async () => {
      const response = await createApp().request(`http://localhost/${BOT_ID}`);

      expect(response.status).toBe(200);
      expect((await response.json()).data.sokoBot).toMatchObject({
        id: BOT_ID,
        userId: null,
        viewerCanManage: false,
      });
      expect(getStateMock).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, {
        kind: "id",
        sokoBotId: BOT_ID,
      });
    });

    it("hides a bot the caller cannot reach", async () => {
      getStateMock.mockResolvedValue(null);

      const response = await createApp().request(`http://localhost/${BOT_ID}`);

      expect(response.status).toBe(404);
    });

    it("always sends the sharedBots list on GET /me", async () => {
      getStateMock.mockResolvedValue(null);

      const response = await createApp().request("http://localhost/me");

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        sokoBot: null,
        sharedBots: [],
      });
      expect(listSharedMock).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID);
    });

    it("lists the shared bots on GET /me", async () => {
      getStateMock.mockResolvedValue(null);
      listSharedMock.mockResolvedValue([
        {
          id: BOT_ID,
          name: "Team bot",
          scope: "workspace",
          projectId: null,
          avatarSeed: null,
          avatarImageUrl: null,
          status: "IDLE",
          archivedAt: null,
          sharedRoomId: null,
          viewerCanManage: true,
        },
      ]);

      const response = await createApp().request("http://localhost/me");

      expect(response.status).toBe(200);
      expect((await response.json()).data.sharedBots).toEqual([
        expect.objectContaining({ id: BOT_ID, viewerCanManage: true }),
      ]);
      expect(listSharedMock).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID);
    });

    it("creates a workspace bot for any member", async () => {
      createSharedMock.mockResolvedValue({ id: BOT_ID });

      const response = await post("/", { scope: "workspace", name: "Team" });

      expect(response.status).toBe(201);
      expect(createSharedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          callerUserId: USER_ID,
          workspaceId: WORKSPACE_ID,
          projectId: null,
          name: "Team",
        }),
      );
    });

    it("creates a shared bot in the creator's timezone", async () => {
      createSharedMock.mockResolvedValue({ id: BOT_ID });

      const response = await post("/", {
        scope: "workspace",
        name: "Team",
        timezone: "America/New_York",
      });

      expect(response.status).toBe(201);
      expect(createSharedMock).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: "America/New_York" }),
      );
    });

    it("rejects an unknown timezone", async () => {
      const response = await post("/", {
        scope: "workspace",
        name: "Team",
        timezone: "Mars/Olympus",
      });

      expect(response.status).toBe(422);
      expect(createSharedMock).not.toHaveBeenCalled();
    });

    it("creates a project bot in the named Project", async () => {
      createSharedMock.mockResolvedValue({ id: BOT_ID });

      const response = await post("/", {
        scope: "project",
        projectId: PROJECT_ID,
        name: "Launch",
      });

      expect(response.status).toBe(201);
      expect(createSharedMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID }),
      );
    });

    it.each([
      ["a project scope without a Project", { scope: "project" }],
      [
        "a workspace scope with a Project",
        { scope: "workspace", projectId: PROJECT_ID },
      ],
      ["an unknown scope", { scope: "team" }],
    ])("rejects %s", async (_label, body) => {
      const response = await post("/", body);

      expect(response.status).toBe(422);
      expect(createSharedMock).not.toHaveBeenCalled();
    });

    it("reactivates a shared bot for a manager", async () => {
      const response = await post(`/${BOT_ID}`);

      expect(response.status).toBe(200);
      expect(reactivateMock).toHaveBeenCalledWith(
        USER_ID,
        WORKSPACE_ID,
        BOT_ID,
      );
    });

    it("answers 404 when archiving a bot the caller cannot reach", async () => {
      resolveMock.mockResolvedValue(null);

      const response = await createApp().request(`http://localhost/${BOT_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      expect(archiveMock).not.toHaveBeenCalled();
    });

    it("passes the management 403 through on reactivate and archive", async () => {
      reactivateMock.mockRejectedValue(forbidden("Only an owner or admin"));
      archiveMock.mockRejectedValue(forbidden("Only an owner or admin"));

      const reactivated = await post(`/${BOT_ID}`);
      const archived = await createApp().request(`http://localhost/${BOT_ID}`, {
        method: "DELETE",
      });

      expect(reactivated.status).toBe(403);
      expect(archived.status).toBe(403);
    });

    it("answers 404 when listing turns of a bot the caller cannot reach", async () => {
      resolveMock.mockResolvedValue(null);
      listTurnsMock.mockResolvedValue({ turns: [], count: 0, hasMore: false });

      const response = await createApp().request(
        `http://localhost/${BOT_ID}/turns`,
      );

      expect(response.status).toBe(404);
      expect(listTurnsMock).not.toHaveBeenCalled();
    });

    it("cancels only a turn of the named bot", async () => {
      turnFindFirstMock.mockResolvedValueOnce(null);
      const elsewhere = await post(`/${BOT_ID}/turns/${TURN_ID}/cancel`);

      expect(elsewhere.status).toBe(404);
      expect(cancelTurnMock).not.toHaveBeenCalled();
      expect(turnFindFirstMock).toHaveBeenCalledWith({
        where: { id: TURN_ID, sokoBotId: BOT_ID },
        select: { id: true },
      });

      turnFindFirstMock.mockResolvedValueOnce({ id: TURN_ID });
      const own = await post(`/${BOT_ID}/turns/${TURN_ID}/cancel`);

      expect(own.status).toBe(200);
      expect(cancelTurnMock).toHaveBeenCalledWith(USER_ID, TURN_ID);
    });

    it("resolves only a decision of the named bot", async () => {
      decisionFindFirstMock.mockResolvedValueOnce(null);
      const elsewhere = await post(`/${BOT_ID}/decisions/${DECISION_ID}`, {
        resolution: "ACCEPT",
      });

      expect(elsewhere.status).toBe(404);
      expect(resolveDecisionMock).not.toHaveBeenCalled();
      expect(decisionFindFirstMock).toHaveBeenCalledWith({
        where: { id: DECISION_ID, sokoBotId: BOT_ID },
        select: { id: true },
      });
    });
  });
});
