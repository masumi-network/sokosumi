import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjectsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listProjects: listProjectsMock },
}));

const { loadBriefingCopySources } = await import("./briefing-copy-sources");

function page(
  projects: { id: string; name: string; briefing: string | null }[],
  nextCursor: string | null,
) {
  return { projects, pagination: { nextCursor } };
}

describe("loadBriefingCopySources", () => {
  beforeEach(() => {
    listProjectsMock.mockReset();
  });

  it("offers briefings from every page of the workspace's projects", async () => {
    listProjectsMock
      .mockResolvedValueOnce(
        page(
          [
            { id: "self", name: "Self", briefing: "Mine" },
            { id: "b", name: "Beta", briefing: "Beta brief" },
          ],
          "page-2",
        ),
      )
      .mockResolvedValueOnce(
        page([{ id: "a", name: "Alpha", briefing: "Alpha brief" }], null),
      );

    await expect(loadBriefingCopySources("self")).resolves.toEqual([
      { id: "a", name: "Alpha", briefing: "Alpha brief" },
      { id: "b", name: "Beta", briefing: "Beta brief" },
    ]);
    expect(listProjectsMock).toHaveBeenNthCalledWith(2, {
      cursor: "page-2",
      limit: 100,
    });
  });

  it("offers no sources when the list fails, so editing still works", async () => {
    listProjectsMock.mockRejectedValue(new Error("Core is down"));

    await expect(loadBriefingCopySources("self")).resolves.toEqual([]);
  });
});
