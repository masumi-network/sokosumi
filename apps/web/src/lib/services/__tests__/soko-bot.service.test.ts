import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreMock = vi.hoisted(() => ({
  getMySokoBot: vi.fn(),
  createMySokoBot: vi.fn(),
  listMySokoBotTurns: vi.fn(),
  resolveMySokoBotDecision: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreMock,
}));

import { sokoBotService } from "../soko-bot.service";

describe("sokoBotService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the user has no active bot", async () => {
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: null } });
    await expect(sokoBotService.getMine()).resolves.toBeNull();
  });

  it("returns the bot DTO unchanged", async () => {
    const bot = { id: "bot_1", name: "Atlas", autonomyLevel: "SUPERVISED" };
    coreMock.getMySokoBot.mockResolvedValue({ data: { sokoBot: bot } });
    await expect(sokoBotService.getMine()).resolves.toBe(bot);
  });

  it("updateAutonomy re-sends identity fields with the new level", async () => {
    coreMock.createMySokoBot.mockResolvedValue({ data: { id: "bot_1" } });
    await sokoBotService.updateAutonomy(
      {
        name: "Atlas",
        avatarSeed: "seed",
        personalityTone: 1,
        personalityDetail: 2,
        personalityStyle: 3,
      } as never,
      "AUTONOMOUS",
    );
    expect(coreMock.createMySokoBot).toHaveBeenCalledWith({
      name: "Atlas",
      avatarSeed: "seed",
      personalityTone: 1,
      personalityDetail: 2,
      personalityStyle: 3,
      autonomyLevel: "AUTONOMOUS",
    });
  });

  it("listTurns forwards the limit and unwraps data", async () => {
    coreMock.listMySokoBotTurns.mockResolvedValue({ data: [{ id: "t1" }] });
    await expect(sokoBotService.listTurns(5)).resolves.toEqual([{ id: "t1" }]);
    expect(coreMock.listMySokoBotTurns).toHaveBeenCalledWith({ limit: 5 });
  });

  it("resolveDecision posts the resolution", async () => {
    coreMock.resolveMySokoBotDecision.mockResolvedValue({
      data: { id: "d1", status: "ACCEPTED" },
    });
    await expect(
      sokoBotService.resolveDecision("d1", { resolution: "ACCEPT" }),
    ).resolves.toEqual({ id: "d1", status: "ACCEPTED" });
    expect(coreMock.resolveMySokoBotDecision).toHaveBeenCalledWith("d1", {
      resolution: "ACCEPT",
    });
  });
});
