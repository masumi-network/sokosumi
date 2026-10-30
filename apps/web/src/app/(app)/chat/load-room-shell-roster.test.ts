import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadOrganizationMembersMock = vi.fn();
const listCoworkersMock = vi.fn();
const getMineMock = vi.fn();

vi.mock("./load-organization-members", () => ({
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembersMock(...args),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: (...args: unknown[]) => getMineMock(...args),
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App") => {
    const { createTranslator } = await import("next-intl");
    const { default: messages } = await import("@/messages/en.json");
    return createTranslator({ locale: "en", messages, namespace });
  },
}));

import { loadRoomShellRoster } from "./load-room-shell-roster";

describe("loadRoomShellRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMineMock.mockResolvedValue(null);
  });

  it("loads members and coworkers in parallel", async () => {
    const members = [{ id: "member_1" }];
    const coworkers = [{ id: "coworker_1" }];
    loadOrganizationMembersMock.mockResolvedValue({
      members,
      failed: false,
    });
    listCoworkersMock.mockResolvedValue(coworkers);

    await expect(loadRoomShellRoster("org_1")).resolves.toEqual({
      organizationMembers: members,
      membersLoadFailed: false,
      coworkers,
      sokoBots: [],
    });
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith("org_1");
    expect(listCoworkersMock).toHaveBeenCalledWith("chat");
  });

  it("carries the bot's avatar style so a crafted avatar can be cropped", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
    getMineMock.mockResolvedValue({
      id: "bot-1",
      name: "Jarvis",
      avatarImageUrl: "https://blob/idle.png",
      avatarSeed: null,
      avatar: { styleId: "crafted-desk" },
    });

    const roster = await loadRoomShellRoster("org_1");

    expect(roster.sokoBots).toEqual([
      expect.objectContaining({
        image: "https://blob/idle.png",
        avatarStyleId: "crafted-desk",
      }),
    ]);
  });

  it("propagates members soft-fail", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: true,
    });
    listCoworkersMock.mockResolvedValue([]);

    await expect(loadRoomShellRoster("org_1")).resolves.toEqual({
      organizationMembers: [],
      membersLoadFailed: true,
      coworkers: [],
      sokoBots: [],
    });
  });

  it("passes null organizationId through for personal workspace", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([{ id: "c1" }]);

    await expect(loadRoomShellRoster(null)).resolves.toEqual({
      organizationMembers: [],
      membersLoadFailed: false,
      coworkers: [{ id: "c1" }],
      sokoBots: [],
    });
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(null);
  });

  it("names a Soko Bot without a name from the catalog", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
    getMineMock.mockResolvedValue({ id: "bot_1", name: null, avatarSeed: "s" });

    const { sokoBots } = await loadRoomShellRoster("org_1");

    expect(sokoBots[0]?.name).toBe("Personal assistant");
  });
});
