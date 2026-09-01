import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadOrganizationMembersMock = vi.fn();
const listCoworkersMock = vi.fn();

vi.mock("./load-organization-members", () => ({
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembersMock(...args),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

const getMineMock = vi.fn();
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: (...args: unknown[]) => getMineMock(...args),
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
      personalAssistant: null,
    });
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith("org_1");
    expect(listCoworkersMock).toHaveBeenCalledWith("chat");
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
      personalAssistant: null,
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
      personalAssistant: null,
    });
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(null);
  });

  it("maps the owner's live PA into personalAssistant", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
    getMineMock.mockResolvedValue({
      id: "bot-1",
      name: "Ada Bot",
      avatarImageUrl: "https://cdn.example/ada.png",
    });

    await expect(loadRoomShellRoster("org_1")).resolves.toEqual({
      organizationMembers: [],
      membersLoadFailed: false,
      coworkers: [],
      personalAssistant: {
        id: "bot-1",
        name: "Ada Bot",
        image: "https://cdn.example/ada.png",
      },
    });
  });
});
