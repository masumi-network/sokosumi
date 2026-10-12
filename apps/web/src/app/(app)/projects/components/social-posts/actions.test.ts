import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SectionKey } from "./constants";
import { SECTION_STATUSES } from "./constants";

const listSocialPosts = vi.hoisted(() => vi.fn());

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listSocialPosts,
  },
}));

describe("loadMoreSocialPosts", () => {
  beforeEach(() => {
    listSocialPosts.mockReset();
    listSocialPosts.mockResolvedValue({ posts: [], nextCursor: null });
  });

  it("rejects an unknown list section", async () => {
    const { loadMoreSocialPosts } = await import("./actions");
    await expect(
      loadMoreSocialPosts({
        projectId: "project-1",
        section: "scheduled" as SectionKey,
        cursor: "cursor-1",
      }),
    ).rejects.toThrow("Invalid social post section");
    expect(listSocialPosts).not.toHaveBeenCalled();
  });

  it("loads drafts and Needs attention with the section statuses", async () => {
    const { loadMoreSocialPosts } = await import("./actions");

    await loadMoreSocialPosts({
      projectId: "project-1",
      section: "drafts",
      cursor: "cursor-1",
    });
    await loadMoreSocialPosts({
      projectId: "project-1",
      section: "attention",
      cursor: "cursor-2",
    });

    expect(listSocialPosts).toHaveBeenNthCalledWith(1, "project-1", {
      statuses: SECTION_STATUSES.drafts,
      cursor: "cursor-1",
    });
    expect(listSocialPosts).toHaveBeenNthCalledWith(2, "project-1", {
      statuses: SECTION_STATUSES.attention,
      cursor: "cursor-2",
    });
    expect(SECTION_STATUSES).toEqual({
      drafts: ["DRAFT"],
      attention: ["FAILED", "MISSED"],
    });
  });
});
