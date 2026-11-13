import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPost, getProject, listConnections, listQueueSlots } = vi.hoisted(
  () => ({
    getPost: vi.fn(),
    getProject: vi.fn(),
    listConnections: vi.fn(),
    listQueueSlots: vi.fn(),
  }),
);

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: getProject,
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
    getProject.mockResolvedValue({ id: "project-1", cmo: false });
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
      readOnly: false,
      queueSlots: [{ id: "slot-1" }],
    });
    expect(listQueueSlots).toHaveBeenCalledWith("project-1");
  });

  it("keeps a CMO Project's post read-only, as its own page does", async () => {
    getProject.mockResolvedValue({ id: "project-1", cmo: true });
    const result = await loadSocialCalendarPreview({
      projectId: "project-1",
      postId: "post-1",
    });
    expect(result.readOnly).toBe(true);
    expect(getProject).toHaveBeenCalledWith("project-1");
  });

  it("offers no actions when the post's Project cannot be read", async () => {
    getProject.mockResolvedValue(null);
    const result = await loadSocialCalendarPreview({
      projectId: "project-1",
      postId: "post-1",
    });
    expect(result.readOnly).toBe(true);
  });

  it("opens the post when the posting queue is not open to the user", async () => {
    listQueueSlots.mockResolvedValue(null);
    const result = await loadSocialCalendarPreview({
      projectId: "project-1",
      postId: "post-1",
    });
    expect(result.queueSlots).toBeUndefined();
    expect(result.post).toEqual({ id: "post-1", projectId: "project-1" });
  });

  it("does not load queue settings for a missing post", async () => {
    getPost.mockResolvedValue(null);
    await expect(
      loadSocialCalendarPreview({ projectId: "project-1", postId: "post-1" }),
    ).rejects.toThrow("Social post not found");
    expect(listQueueSlots).not.toHaveBeenCalled();
  });
});
