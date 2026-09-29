import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDefaultVersionIdMock,
  listVersionsMock,
  getForAdminMock,
  listEvaluationsMock,
} = vi.hoisted(() => ({
  getDefaultVersionIdMock: vi.fn(),
  listVersionsMock: vi.fn(),
  getForAdminMock: vi.fn(),
  listEvaluationsMock: vi.fn(),
}));

vi.mock("@/services/soko-bot-model-evaluation.service", () => ({
  listSokoBotModelEvaluations: listEvaluationsMock,
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role: "admin",
      });
      await next();
    },
  };
});

vi.mock("@/services/soko-bot-version.service", () => ({
  archiveAuthoredVersion: vi.fn(),
  createAuthoredVersion: vi.fn(),
  getDefaultSokoBotVersionId: getDefaultVersionIdMock,
  listSokoBotVersions: listVersionsMock,
  promoteSokoBotVersion: vi.fn(),
  updateAuthoredVersion: vi.fn(),
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
      getForAdmin: getForAdminMock,
    },
  };
});

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import nestedApp from "./index";

const app = new OpenAPIHonoWithAuth();
app.route("/", nestedApp);

describe("admin Soko Bot route precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDefaultVersionIdMock.mockResolvedValue("v11");
    listVersionsMock.mockResolvedValue([
      {
        id: "v11",
        name: "Version 11",
        createdAt: "2026-08-01",
        summary: "Built-in default",
        model: "gateway/model-v11",
        inferenceRegion: undefined,
        systemPrompt: "Operate carefully.",
        skills: [],
        capabilities: [],
        authored: false,
      },
    ]);
  });

  it("matches the versions collection before the bot detail parameter", async () => {
    const response = await app.request("http://localhost/versions");

    expect(response.status).toBe(200);
    expect(getForAdminMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        defaultVersionId: "v11",
        versions: [{ id: "v11", isDefault: true }],
      },
    });
  });

  it("serves model evaluations, not a bot named 'evaluations'", async () => {
    listEvaluationsMock.mockResolvedValue({
      currentJudgeModel: "anthropic/claude-opus-5.5",
      currentRouteModel: "typesafe-ai/jev",
      judge: [
        {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: new Date("2026-09-30T10:00:00Z"),
          label: "Judge comparison",
          inUseModel: "anthropic/claude-opus-5.5",
          models: [
            {
              model: "anthropic/claude-opus-5.5",
              calls: 2,
              errors: 0,
              steady: 1,
              repeated: 1,
              matches: 1,
              graded: 1,
              falseFails: 0,
              badCaught: 0,
              bad: 0,
              costPerCallUsd: 0.17,
              medianMs: 8_000,
            },
          ],
          cases: [
            {
              caseId: "chat-post",
              grade: "pass",
              why: null,
              set: "lab",
              answers: { "anthropic/claude-opus-5.5": ["pass", "pass"] },
              contested: false,
            },
          ],
        },
      ],
      router: [],
    });

    const response = await app.request("http://localhost/evaluations");

    expect(response.status).toBe(200);
    expect(getForAdminMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        judge: [
          {
            inUseModel: "anthropic/claude-opus-5.5",
            createdAt: "2026-09-30T10:00:00.000Z",
            models: [{ matches: 1, graded: 1 }],
          },
        ],
        router: [],
      },
    });
  });
});
