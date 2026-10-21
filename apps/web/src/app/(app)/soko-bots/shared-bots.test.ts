import { beforeEach, describe, expect, it, vi } from "vitest";

const listSharedMock = vi.fn();
const projectsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { listShared: () => listSharedMock() },
}));
vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: () => projectsMock(),
}));

import { loadSharedBots } from "./shared-bots";

describe("loadSharedBots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Core sends no sharedBots", async () => {
    listSharedMock.mockResolvedValue(null);
    await expect(loadSharedBots()).resolves.toBeNull();
    expect(projectsMock).not.toHaveBeenCalled();
  });

  it("returns null when the read fails", async () => {
    listSharedMock.mockRejectedValue(new Error("Core down"));
    await expect(loadSharedBots()).resolves.toBeNull();
  });

  it("keeps an empty list so the section can offer to create one", async () => {
    listSharedMock.mockResolvedValue([]);
    projectsMock.mockResolvedValue([{ id: "p1", name: "Launch", extra: 1 }]);
    await expect(loadSharedBots()).resolves.toEqual({
      bots: [],
      projects: [{ id: "p1", name: "Launch" }],
    });
  });

  it("still shows the bots when the project list fails", async () => {
    const bots = [{ id: "b1" }];
    listSharedMock.mockResolvedValue(bots);
    projectsMock.mockRejectedValue(new Error("down"));
    await expect(loadSharedBots()).resolves.toEqual({ bots, projects: [] });
  });
});
