import { beforeEach, describe, expect, it, vi } from "vitest";

const listTaskScheduleAssigneeOptionsMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();

vi.mock("./task-schedule-assignee-options", () => ({
  listTaskScheduleAssigneeOptions: () => listTaskScheduleAssigneeOptionsMock(),
}));

vi.mock("./task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (...args: unknown[]) =>
    listTaskAssigneeMemberOptionsMock(...args),
}));

import { listTaskAssigneeOptions } from "./task-assignee-options";

const MEMBER_OPTION = {
  id: "user-1",
  slug: "alice@example.com",
  name: "Alice",
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
  id: "coworker-1",
  slug: "coworker-one",
  name: "Coworker One",
  kind: "coworker" as const,
  image: "",
  vendor: { id: "vendor-1", name: "Vendor", slug: "vendor", logos: {} },
};

describe("listTaskAssigneeOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([MEMBER_OPTION]);
    listTaskScheduleAssigneeOptionsMock.mockResolvedValue([
      { id: "bot-1", kind: "sokoBot", name: "sokoBot" },
      COWORKER,
    ]);
  });

  it("lists the owner Soko Bot first, then members and coworkers of the workspace", async () => {
    const options = await listTaskAssigneeOptions("org-1");

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(listTaskScheduleAssigneeOptionsMock).toHaveBeenCalledOnce();
    expect(options.map((option) => [option.id, option.kind])).toEqual([
      ["bot-1", "sokoBot"],
      ["user-1", "user"],
      ["coworker-1", "coworker"],
    ]);
    expect(options[0]?.name).toBe("sokoBot");
  });

  it("still lists members when coworkers and the Soko Bot fail to load", async () => {
    listTaskScheduleAssigneeOptionsMock.mockRejectedValue(
      new Error("core down"),
    );

    const options = await listTaskAssigneeOptions("org-1");

    expect(options.map((option) => option.id)).toEqual(["user-1"]);
  });

  it("reuses members already loaded by the Tasks page", async () => {
    const options = await listTaskAssigneeOptions("org-1", [MEMBER_OPTION]);

    expect(listTaskAssigneeMemberOptionsMock).not.toHaveBeenCalled();
    expect(options.map((option) => option.id)).toEqual([
      "bot-1",
      "user-1",
      "coworker-1",
    ]);
  });
});
