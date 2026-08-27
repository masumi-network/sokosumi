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
      listAdminSokoBots: vi.fn(),
      getAdminSokoBot: vi.fn(),
      getAdminSokoBotQuality: vi.fn(),
      performAdminSokoBotAction: vi.fn(),
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
