import { beforeEach, describe, expect, it, vi } from "vitest";

const listCoworkersMock = vi.fn();
const getMineMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();

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

vi.mock("./task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (...args: unknown[]) =>
    listTaskAssigneeMemberOptionsMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

import { listTaskAssigneeOptions } from "./task-assignee-options";

const MEMBER_OPTION = {
  id: "user-1",
  slug: "alice@example.com",
  name: "Alice",
  kind: "user",
  image: "",
  vendor: {
    id: "workspace-members",
    name: "Members",
    slug: "workspace-members",
  },
};
const COWORKER = {
  id: "coworker-1",
  slug: "coworker-one",
  name: "Coworker One",
  image: "",
  vendor: { id: "vendor-1", name: "Vendor", slug: "vendor", logos: {} },
};

describe("listTaskAssigneeOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([MEMBER_OPTION]);
    listCoworkersMock.mockResolvedValue([COWORKER]);
    getMineMock.mockResolvedValue({
      id: "bot-1",
      name: "",
      avatarImageUrl: null,
      avatarSeed: "seed",
    });
  });

  it("lists the owner Soko Bot first, then members and coworkers of the workspace", async () => {
    const options = await listTaskAssigneeOptions("org-1");

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(listCoworkersMock).toHaveBeenCalledWith("tasks");
    expect(options.map((option) => [option.id, option.kind])).toEqual([
      ["bot-1", "sokoBot"],
      ["user-1", "user"],
      ["coworker-1", "coworker"],
    ]);
    expect(options[0]?.name).toBe("sokoBot");
  });

  it("still lists members when coworkers and the Soko Bot fail to load", async () => {
    listCoworkersMock.mockRejectedValue(new Error("core down"));
    getMineMock.mockRejectedValue(new Error("core down"));

    const options = await listTaskAssigneeOptions("org-1");

    expect(options.map((option) => option.id)).toEqual(["user-1"]);
  });
});
