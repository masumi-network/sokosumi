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
  getTranslations: vi.fn(
    async () => (key: string) =>
      key === "personalAssistantBadge" ? "Personal assistant" : key,
  ),
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
      orchestrators: [],
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
      orchestrators: [],
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
      orchestrators: [],
    });
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(null);
  });
});
