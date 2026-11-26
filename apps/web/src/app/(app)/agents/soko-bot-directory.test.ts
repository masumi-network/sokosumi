import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeamMock = vi.fn();
const loadSharedBotsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getTeam: getTeamMock },
}));
vi.mock("@/app/soko-bots/shared-bots", () => ({
  loadSharedBots: loadSharedBotsMock,
}));
vi.mock("@/components/soko-bot/bot-face", () => ({
  botFaceSeed: (bot: { id: string }) => `seed:${bot.id}`,
}));

const { loadBotDirectory } = await import("./soko-bot-directory");

function personalBot(id: string, status: string, lastActivityAt: Date | null) {
  return {
    id,
    name: id,
    avatarImageUrl: null,
    avatarSeed: null,
    status,
    lastActivityAt,
  };
}

function sharedBot(overrides: Record<string, unknown>) {
  return {
    id: "shared",
    name: "Atlas",
    scope: "workspace",
    projectId: null,
    avatarSeed: null,
    avatarImageUrl: null,
    status: "IDLE",
    archivedAt: null,
    sharedRoomId: "room-1",
    viewerCanManage: false,
    cuso: false,
    ...overrides,
  };
}

describe("loadBotDirectory", () => {
  beforeEach(() => {
    getTeamMock.mockReset();
    loadSharedBotsMock.mockReset();
  });

  it("lists every bot with its owner: yours first, then working ones, then shared", async () => {
    getTeamMock.mockResolvedValue({
      workspace: { id: "w", kind: "organization", name: "Acme", logo: null },
      members: [
        {
          userId: "u-bob",
          name: "Bob",
          image: null,
          role: null,
          isYou: false,
          bot: personalBot("milo", "IDLE", new Date("2026-11-20")),
        },
        {
          userId: "u-cid",
          name: "Cid",
          image: "https://example.com/cid.png",
          role: null,
          isYou: false,
          bot: personalBot("nova", "RUNNING", null),
        },
        {
          userId: "u-dee",
          name: "Dee",
          image: null,
          role: null,
          isYou: false,
          bot: null,
        },
        {
          userId: "u-me",
          name: "Me",
          image: null,
          role: null,
          isYou: true,
          bot: personalBot("juno", "IDLE", null),
        },
      ],
    });
    loadSharedBotsMock.mockResolvedValue({
      bots: [
        sharedBot({}),
        sharedBot({ id: "proj", scope: "project", projectId: "p-1" }),
        sharedBot({ id: "old", archivedAt: new Date() }),
      ],
      projects: [{ id: "p-1", name: "Launch", cmo: false }],
    });

    const directory = await loadBotDirectory();

    expect(directory.workspaceName).toBe("Acme");
    expect(directory.hasOwnBot).toBe(true);
    expect(directory.bots.map((bot) => [bot.id, bot.owner])).toEqual([
      ["juno", { kind: "you", name: "Me", image: null }],
      [
        "nova",
        { kind: "person", name: "Cid", image: "https://example.com/cid.png" },
      ],
      ["milo", { kind: "person", name: "Bob", image: null }],
      ["shared", { kind: "team" }],
      ["proj", { kind: "project", name: "Launch" }],
    ]);
    expect(directory.bots.find((bot) => bot.id === "milo")?.canConfigure).toBe(
      false,
    );
    expect(
      directory.bots.find((bot) => bot.id === "shared")?.sharedRoomId,
    ).toBe("room-1");
  });

  it("says when the viewer has no bot of their own", async () => {
    getTeamMock.mockResolvedValue({
      workspace: { id: "w", kind: "personal", name: "Me", logo: null },
      members: [
        {
          userId: "u-me",
          name: "Me",
          image: null,
          role: null,
          isYou: true,
          bot: null,
        },
      ],
    });
    loadSharedBotsMock.mockResolvedValue(null);

    const directory = await loadBotDirectory();

    expect(directory.bots).toEqual([]);
    expect(directory.hasOwnBot).toBe(false);
  });
});
