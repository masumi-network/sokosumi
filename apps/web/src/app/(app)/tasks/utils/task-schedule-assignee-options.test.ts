import { beforeEach, describe, expect, it, vi } from "vitest";

const listAssigneesMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listAssignees: () => listAssigneesMock(),
  },
}));

vi.mock("./task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (organizationId: string | null) =>
    listTaskAssigneeMemberOptionsMock(organizationId),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

import { listTaskScheduleAssigneeDisplayOptions } from "./task-schedule-assignee-options";

const MEMBER = {
  id: "user-1",
  slug: "maya",
  name: "Maya",
  kind: "user" as const,
  image: "",
  vendor: {
    id: "workspace-members",
    name: "Members",
    slug: "workspace-members",
    logos: { light: null, dark: null },
  },
};

const COWORKER = {
  id: "cow-1",
  slug: "ops",
  name: "Ops",
  image: "",
  description: null,
  caption: null,
  priority: 1,
  vendor: {
    id: "vendor-1",
    name: "Vendor",
    slug: "vendor",
    logos: { light: null, dark: null },
  },
};

describe("listTaskScheduleAssigneeDisplayOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAssigneesMock.mockResolvedValue({
      coworkers: [COWORKER],
      sokoBot: {
        id: "bot-1",
        name: "Atlas",
        avatarSeed: null,
        avatarImageUrl: null,
      },
    });
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([MEMBER]);
  });

  it("keeps agent choices and adds the stored member name", async () => {
    const options = await listTaskScheduleAssigneeDisplayOptions("org-1");

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(options.map((option) => [option.id, option.kind])).toEqual([
      ["bot-1", "sokoBot"],
      ["cow-1", "coworker"],
      ["user-1", "user"],
    ]);
  });

  it("does not add a member already present as an agent", async () => {
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([
      MEMBER,
      { ...MEMBER, id: "cow-1", name: "Not Ops" },
    ]);

    const options = await listTaskScheduleAssigneeDisplayOptions(null);

    expect(options.filter((option) => option.id === "cow-1")).toHaveLength(1);
    expect(options.map((option) => option.id)).toEqual([
      "bot-1",
      "cow-1",
      "user-1",
    ]);
  });
});
