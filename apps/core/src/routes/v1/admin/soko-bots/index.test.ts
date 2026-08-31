import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDefaultVersionIdMock, listVersionsMock, getForAdminMock } =
  vi.hoisted(() => ({
    getDefaultVersionIdMock: vi.fn(),
    listVersionsMock: vi.fn(),
    getForAdminMock: vi.fn(),
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

import app from "./index";

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
});
