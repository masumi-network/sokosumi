import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreMock = vi.hoisted(() => ({
  getMySokoBot: vi.fn(),
  createMySokoBot: vi.fn(),
  listMySokoBotTurns: vi.fn(),
  resolveMySokoBotDecision: vi.fn(),
  createSokoBot: vi.fn(),
  archiveMySokoBot: vi.fn(),
  listMySokoBotIntegrations: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreMock,
}));

import { sokoBotService } from "./soko-bot.service";

describe("sokoBotService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the user has no active bot", async () => {
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: null } });
    await expect(sokoBotService.getMine()).resolves.toBeNull();
  });

  it("returns the bot DTO unchanged", async () => {
    const bot = { id: "bot_1", name: "Atlas" };
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: bot } });
    await expect(sokoBotService.getMine()).resolves.toBe(bot);
  });

  it("listTurns forwards the limit and unwraps data", async () => {
    coreMock.listMySokoBotTurns.mockResolvedValue({ data: [{ id: "t1" }] });
    await expect(sokoBotService.listTurns(5)).resolves.toEqual([{ id: "t1" }]);
    expect(coreMock.listMySokoBotTurns).toHaveBeenCalledWith(
      { limit: 5 },
      undefined,
    );
  });

  it("resolveDecision posts the resolution", async () => {
    coreMock.resolveMySokoBotDecision.mockResolvedValue({
      data: { id: "d1", status: "ACCEPTED" },
    });
    await expect(
      sokoBotService.resolveDecision("d1", { resolution: "ACCEPT" }),
    ).resolves.toEqual({ id: "d1", status: "ACCEPTED" });
    expect(coreMock.resolveMySokoBotDecision).toHaveBeenCalledWith(
      "d1",
      {
        resolution: "ACCEPT",
      },
      undefined,
    );
  });

  it("reads a shared bot by id", async () => {
    const bot = { id: "bot_2", userId: null };
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: bot } });
    await expect(sokoBotService.getMine("bot_2")).resolves.toBe(bot);
    expect(coreMock.getMySokoBot).toHaveBeenCalledWith("bot_2");
  });

  it("listShared returns Core's shared bots", async () => {
    const sharedBots = [{ id: "bot_2", scope: "workspace" }];
    coreMock.getMySokoBot.mockResolvedValue({
      data: { sokoBot: null, sharedBots },
    });
    await expect(sokoBotService.listShared()).resolves.toBe(sharedBots);
  });

  it("listShared returns null when Core leaves the field out", async () => {
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: null } });
    await expect(sokoBotService.listShared()).resolves.toBeNull();
  });

  it("listShared keeps an empty list apart from an absent one", async () => {
    coreMock.getMySokoBot.mockResolvedValue({
      data: { sokoBot: null, sharedBots: [] },
    });
    await expect(sokoBotService.listShared()).resolves.toEqual([]);
  });

  it("createScoped posts the scope and unwraps the bot", async () => {
    coreMock.createSokoBot.mockResolvedValue({ data: { id: "bot_3" } });
    await expect(
      sokoBotService.createScoped({ name: "Ops", scope: "workspace" }),
    ).resolves.toEqual({ id: "bot_3" });
    expect(coreMock.createSokoBot).toHaveBeenCalledWith({
      name: "Ops",
      scope: "workspace",
    });
  });

  it("archive passes the shared bot's id", async () => {
    coreMock.archiveMySokoBot.mockResolvedValue({ data: {} });
    await sokoBotService.archive("bot_2");
    expect(coreMock.archiveMySokoBot).toHaveBeenCalledWith("bot_2");
  });

  it("surfaces a Core failure from listShared", async () => {
    coreMock.getMySokoBot.mockRejectedValue(new Error("Core down"));
    await expect(sokoBotService.listShared()).rejects.toThrow("Core down");
  });

  it("hides the chat's connect prompt once anything is connected", async () => {
    coreMock.getMySokoBot.mockResolvedValue({
      data: { sokoBot: { id: "bot_1", name: "Atlas" } },
    });
    coreMock.listMySokoBotIntegrations.mockResolvedValue({
      data: {
        configured: true,
        integrations: [
          { provider: "slack", kinds: [], status: "ACTIVE" },
          { provider: "gmail", kinds: ["email"], status: "DISCONNECTED" },
        ],
      },
    });
    await expect(
      sokoBotService.getConnectPromptState({ untilAnyConnected: true }),
    ).resolves.toBeNull();
    await expect(sokoBotService.getConnectPromptState()).resolves.toMatchObject(
      { botId: "bot_1" },
    );
  });
});
