import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { coreMock, MockCoreApiRequestError } = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    coreMock: {
      archiveAdminSokoBotVersion: vi.fn(),
      createAdminSokoBotVersion: vi.fn(),
      listAdminSokoBots: vi.fn(),
      listAdminSokoBotGatewayModels: vi.fn(),
      listAdminSokoBotVersions: vi.fn(),
      getAdminSokoBot: vi.fn(),
      getAdminSokoBotQuality: vi.fn(),
      performAdminSokoBotAction: vi.fn(),
      promoteAdminSokoBotVersion: vi.fn(),
      updateAdminSokoBotVersion: vi.fn(),
    },
    MockCoreApiRequestError,
  };
});

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreMock,
  CoreApiRequestError: MockCoreApiRequestError,
}));

import { adminSokoBotService } from "../admin-soko-bot.service";

describe("adminSokoBotService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trims the search query and drops empty strings", async () => {
    coreMock.listAdminSokoBots.mockResolvedValue({
      data: { items: [], total: 0 },
    });
    await adminSokoBotService.list({ query: "   ", limit: 50 });
    expect(coreMock.listAdminSokoBots).toHaveBeenCalledWith({
      query: undefined,
      limit: 50,
    });
    await adminSokoBotService.list({ query: " ada " });
    expect(coreMock.listAdminSokoBots).toHaveBeenLastCalledWith({
      query: "ada",
      limit: undefined,
    });
  });

  it("passes the selected version to the quality endpoint", async () => {
    coreMock.getAdminSokoBotQuality.mockResolvedValue({
      data: { overall: { turns: 0 } },
    });

    await adminSokoBotService.quality({ versionId: "test-v2" });

    expect(coreMock.getAdminSokoBotQuality).toHaveBeenCalledWith({
      versionId: "test-v2",
    });
  });

  it("loads the authored-version catalog and gateway models", async () => {
    const catalog = {
      versions: [],
      defaultVersionId: "v11",
      availableCapabilities: ["tasks.read"],
      availableSkills: [
        {
          id: "project-manager",
          name: "Project manager",
          description: "Plans and follows up on work.",
          installed: false,
        },
      ],
    };
    const models = {
      models: [
        {
          id: "anthropic/claude-sonnet-4.5",
          name: "Claude Sonnet 4.5",
          regions: ["eu", "us"],
        },
      ],
    };
    coreMock.listAdminSokoBotVersions.mockResolvedValue({ data: catalog });
    coreMock.listAdminSokoBotGatewayModels.mockResolvedValue({ data: models });

    await expect(adminSokoBotService.listVersions()).resolves.toEqual(catalog);
    await expect(adminSokoBotService.listGatewayModels()).resolves.toEqual(
      models,
    );
  });

  it("preserves every authored-version field on create and update", async () => {
    const input = {
      slug: "v12-operator",
      name: "Operator",
      summary: "Handles complex work.",
      model: "anthropic/claude-sonnet-4.5",
      inferenceRegion: "eu" as const,
      systemPrompt: "You are the operator.",
      skills: ["project-manager"],
      capabilities: ["tasks.read", "tasks.write"],
    };
    const detail = {
      id: input.slug,
      name: input.name,
      createdAt: "2026-08-27",
      summary: input.summary,
      model: input.model,
      inferenceRegion: input.inferenceRegion,
      systemPrompt: input.systemPrompt,
      skills: input.skills,
      capabilities: input.capabilities,
      authored: true,
      isDefault: false,
    };
    coreMock.createAdminSokoBotVersion.mockResolvedValue({ data: detail });
    coreMock.updateAdminSokoBotVersion.mockResolvedValue({ data: detail });

    await expect(adminSokoBotService.createVersion(input)).resolves.toEqual(
      detail,
    );
    expect(coreMock.createAdminSokoBotVersion).toHaveBeenCalledWith(input);

    const { slug, ...update } = input;
    await expect(
      adminSokoBotService.updateVersion(slug, update),
    ).resolves.toEqual(detail);
    expect(coreMock.updateAdminSokoBotVersion).toHaveBeenCalledWith(
      slug,
      update,
    );
  });

  it("archives and promotes the requested authored version", async () => {
    coreMock.archiveAdminSokoBotVersion.mockResolvedValue({
      data: { archived: true },
    });
    coreMock.promoteAdminSokoBotVersion.mockResolvedValue({
      data: { defaultVersionId: "v12-operator" },
    });

    await expect(
      adminSokoBotService.archiveVersion("v12-operator"),
    ).resolves.toBeUndefined();
    await expect(
      adminSokoBotService.promoteVersion("v12-operator"),
    ).resolves.toEqual({ defaultVersionId: "v12-operator" });
    expect(coreMock.archiveAdminSokoBotVersion).toHaveBeenCalledWith(
      "v12-operator",
    );
    expect(coreMock.promoteAdminSokoBotVersion).toHaveBeenCalledWith(
      "v12-operator",
    );
  });

  it("returns null for an unknown bot (404) and rethrows other errors", async () => {
    coreMock.getAdminSokoBot.mockRejectedValueOnce(
      new MockCoreApiRequestError("not found", 404),
    );
    await expect(adminSokoBotService.get("missing")).resolves.toBeNull();

    coreMock.getAdminSokoBot.mockRejectedValueOnce(
      new MockCoreApiRequestError("boom", 500),
    );
    await expect(adminSokoBotService.get("bot_1")).rejects.toThrow("boom");
  });

  it("performAction posts action + reason and returns the detail", async () => {
    coreMock.performAdminSokoBotAction.mockResolvedValue({
      data: { id: "bot_1", status: "PAUSED" },
    });
    await expect(
      adminSokoBotService.performAction("bot_1", {
        operationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        action: "PAUSE",
        reason: "Runaway turns",
      }),
    ).resolves.toEqual({ id: "bot_1", status: "PAUSED" });
    expect(coreMock.performAdminSokoBotAction).toHaveBeenCalledWith("bot_1", {
      operationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      action: "PAUSE",
      reason: "Runaway turns",
    });
  });
});
