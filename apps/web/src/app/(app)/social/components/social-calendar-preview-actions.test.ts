import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPost, listConnections, listQueueSlots } = vi.hoisted(() => ({
  getPost: vi.fn(),
  listConnections: vi.fn(),
  listQueueSlots: vi.fn(),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getSocialPost: getPost,
    listSocialConnections: listConnections,
    listSocialQueueSlots: listQueueSlots,
  },
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: (handler: unknown) => handler,
}));

import { loadSocialCalendarPreview } from "./social-calendar-preview-actions";

describe("loadSocialCalendarPreview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getPost.mockResolvedValue({ id: "post-1", projectId: "project-1" });
    listConnections.mockResolvedValue([
      { id: "active", status: "active" },
      { id: "disconnected", status: "disconnected" },
    ]);
    listQueueSlots.mockResolvedValue({
      timezone: "UTC",
      slots: [{ id: "slot-1" }],
    });
  });

  it("loads the post's own queue and keeps main's active-account filter", async () => {
    const result = await loadSocialCalendarPreview({
      projectId: "project-1",
      postId: "post-1",
    });
    expect(result).toEqual({
      post: { id: "post-1", projectId: "project-1" },
      connections: [{ id: "active", status: "active" }],
      queueSlots: [{ id: "slot-1" }],
    });
    expect(listQueueSlots).toHaveBeenCalledWith("project-1");
  });

  it("does not load queue settings for a missing post", async () => {
    getPost.mockResolvedValue(null);
    await expect(
      loadSocialCalendarPreview({ projectId: "project-1", postId: "post-1" }),
    ).rejects.toThrow("Social post not found");
    expect(listQueueSlots).not.toHaveBeenCalled();
  });
});
