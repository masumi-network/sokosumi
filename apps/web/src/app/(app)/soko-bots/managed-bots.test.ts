import type { SharedSokoBotSummary } from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTeamMock, getStatsMock, loadSharedMock } = vi.hoisted(() => ({
  getTeamMock: vi.fn(),
  getStatsMock: vi.fn(),
  loadSharedMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getTeam: getTeamMock, getStats: getStatsMock },
}));
vi.mock("./shared-bots", () => ({ loadSharedBots: loadSharedMock }));
vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class extends Error {},
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { loadManagedSharedBots, loadSokoBotsManagement } from "./managed-bots";

function shared(
  overrides: Partial<SharedSokoBotSummary>,
): SharedSokoBotSummary {
  return {
    id: "atlas",
    name: "Atlas",
    scope: "workspace",
    projectId: null,
    avatarSeed: null,
    avatarImageUrl: null,
    status: "IDLE",
    archivedAt: null,
    sharedRoomId: "room",
    viewerCanManage: true,
    cuso: false,
    ...overrides,
  };
}

function stats(paused: boolean) {
  return { proactive: { paused } };
}

function team(kind: "organization" | "personal", hasBot: boolean) {
  return {
    workspace: { id: "ws", kind, name: "Acme", logo: null },
    members: [
      {
        userId: "me",
        name: "Alice",
        image: null,
        role: "owner",
        isYou: true,
        bot: hasBot
          ? {
              id: "juno",
              name: "Juno",
              avatarImageUrl: null,
              avatarSeed: null,
              status: "IDLE",
              lastActivityAt: null,
            }
          : null,
      },
      {
        userId: "bob",
        name: "Bob",
        image: null,
        role: "member",
        isYou: false,
        bot: {
          id: "milo",
          name: "Milo",
          avatarImageUrl: null,
          avatarSeed: null,
          status: "IDLE",
          lastActivityAt: null,
        },
      },
    ],
  };
}

describe("loadManagedSharedBots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatsMock.mockResolvedValue(stats(true));
  });

  it("lets a manager pause and archive a live bot, and restore an archived one", async () => {
    const archivedAt = new Date("2026-11-20");
    const [live, archived] = await loadManagedSharedBots(
      [shared({}), shared({ id: "old", archivedAt })],
      [],
    );
    expect(live).toMatchObject({
      settingsHref: "/soko-bots/atlas",
      targetId: "atlas",
      paused: true,
      canArchive: true,
      canRestore: false,
    });
    expect(archived).toMatchObject({
      paused: null,
      canArchive: false,
      archivedAt,
      canRestore: true,
    });
    expect(getStatsMock).toHaveBeenCalledTimes(1);
  });

  it("lets a member pause but not archive or restore", async () => {
    const [live, archived] = await loadManagedSharedBots(
      [
        shared({ viewerCanManage: false }),
        shared({ id: "old", viewerCanManage: false, archivedAt: new Date() }),
      ],
      [],
    );
    expect(live).toMatchObject({ paused: true, canArchive: false });
    expect(archived).toMatchObject({ canRestore: false });
  });

  it("leaves Cuso to CMO: Settings only", async () => {
    const [cuso] = await loadManagedSharedBots(
      [shared({ cuso: true, scope: "project", projectId: "p1" })],
      [{ id: "p1", name: "Launch" }],
    );
    expect(cuso).toMatchObject({
      paused: null,
      canArchive: false,
      owner: { kind: "project", name: "Launch" },
    });
    expect(getStatsMock).not.toHaveBeenCalled();
  });

  it("hides Pause when the paused state can't be read", async () => {
    getStatsMock.mockRejectedValue(new Error("down"));
    const [bot] = await loadManagedSharedBots([shared({})], []);
    expect(bot?.paused).toBeNull();
  });
});

describe("loadSokoBotsManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatsMock.mockResolvedValue(stats(false));
    loadSharedMock.mockResolvedValue({ bots: [shared({})], projects: [] });
  });

  it("lists your own bot first, then the shared ones, never a teammate's", async () => {
    getTeamMock.mockResolvedValue(team("organization", true));
    const { bots, projects } = await loadSokoBotsManagement();
    expect(bots.map((bot) => bot.id)).toEqual(["juno", "atlas"]);
    expect(bots[0]).toMatchObject({
      settingsHref: "/personal-assistant",
      targetId: null,
      paused: false,
      canArchive: true,
    });
    expect(projects).toEqual([]);
  });

  it("drops shared bots and the create choices in a personal workspace", async () => {
    getTeamMock.mockResolvedValue(team("personal", false));
    const { bots, projects } = await loadSokoBotsManagement();
    expect(bots).toEqual([]);
    expect(projects).toBeNull();
  });

  it("returns no team when Core refuses the read", async () => {
    getTeamMock.mockRejectedValue(new CoreApiRequestError("down"));
    const { team: loaded, bots } = await loadSokoBotsManagement();
    expect(loaded).toBeNull();
    expect(bots).toEqual([]);
  });
});
