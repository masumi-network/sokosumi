import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, requireBotMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  requireBotMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotIntegration: { findMany: findManyMock } },
}));
vi.mock("@/clients/composio.client", () => ({ getComposio: () => null }));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  catalogLogos: vi.fn().mockResolvedValue(new Map()),
  requireBot: requireBotMock,
}));

import {
  listSokoBotIntegrations,
  listSokoBotIntegrationsForBot,
} from "./soko-bot-integration-list.service";

const ROW = {
  id: "row-1",
  provider: "gmail",
  name: "Work mail",
  logoUrl: null,
  status: "ACTIVE",
  connectedAt: null,
  lastIngestAt: null,
  lastError: null,
};

describe("Soko Bot integration listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([ROW]);
  });

  it("lists exactly the named bot's rows", async () => {
    const result = await listSokoBotIntegrationsForBot("shared-bot");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sokoBotId: "shared-bot" } }),
    );
    expect(requireBotMock).not.toHaveBeenCalled();
    expect(result.integrations[0]).toMatchObject({
      provider: "gmail",
      name: "Work mail",
      status: "ACTIVE",
    });
  });

  it("keeps the me route on the member's own bot", async () => {
    requireBotMock.mockResolvedValue({ id: "personal-bot" });
    await listSokoBotIntegrations("member-1", "ws-1");
    expect(requireBotMock).toHaveBeenCalledWith("member-1", "ws-1");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sokoBotId: "personal-bot" } }),
    );
  });
});
