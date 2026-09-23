import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceCalendar } from "./read";

const mocks = vi.hoisted(() => ({
  tasks: vi.fn(),
  taskCount: vi.fn(),
  posts: vi.fn(),
  postCount: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskScheduleOccurrence: { findMany: mocks.tasks, count: mocks.taskCount },
    socialPost: { findMany: mocks.posts, count: mocks.postCount },
  },
}));
const workspaceId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const postId = "33333333-3333-7333-8333-333333333333";
const at = "2026-09-23T12:00:00.000Z";
const query = {
  from: new Date("2026-09-23T00:00:00.000Z"),
  to: new Date("2026-09-24T00:00:00.000Z"),
  includeSocialPosts: true,
  limit: 1,
  cursor: null,
  requestedCursor: null,
  scope: "workspace" as const,
};
const post = {
  id: postId,
  text: "Launch",
  status: "SCHEDULED",
  scheduledAt: new Date(at),
  projectId,
  workspaceId,
  socialConnection: { externalHandle: "team" },
  project: { name: "Launch project" },
  scheduledByUser: { name: "Albina" },
  media: [
    {
      pathname: "drive/launch.png",
      fileUrl: "https://example.com/launch.png",
      name: "launch.png",
      size: 100,
      mimeType: "image/png",
      kind: "image",
    },
  ],
};
const occurrence = {
  id: "00000000-0000-7000-8000-000000000001",
  scheduleVersion: 2,
  originalScheduledAt: new Date(at),
  effectiveScheduledAt: new Date(at),
  state: "PLANNED",
  sourceWorkspaceId: workspaceId,
  sourceProjectId: projectId,
  sourceType: "PROJECT",
  sourceAccuracy: "EXACT",
  timeAccuracy: "EXACT",
  seriesTask: {
    id: "task",
    name: "Prepare",
    ownerId: "user",
    status: "READY",
    assigneeId: null,
    assigneeUserId: null,
    metadata: null,
    scheduleRevision: 0,
  },
  releasedTask: null,
};

describe("Social posts in the calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tasks.mockResolvedValue([]);
    mocks.taskCount.mockResolvedValue(0);
    mocks.posts.mockResolvedValue([post]);
    mocks.postCount.mockResolvedValue(1);
  });
  it("merges tasks and posts with stable pagination at the same timestamp", async () => {
    mocks.tasks.mockResolvedValue([occurrence]);
    mocks.taskCount.mockResolvedValue(1);
    const first = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(first.items[0]?.id).toBe(occurrence.id);
    expect(first.pagination.total).toBe(2);
    const cursor = JSON.parse(
      Buffer.from(first.pagination.nextCursor!, "base64url").toString(),
    );
    mocks.tasks.mockResolvedValue([]);
    const second = await readWorkspaceCalendar(workspaceId, "user", {
      ...query,
      cursor,
    });
    expect(second.items[0]).toMatchObject({
      kind: "socialPost",
      postId,
      status: "SCHEDULED",
      externalHandle: "team",
      projectName: "Launch project",
      scheduledByName: "Albina",
      attachmentCount: 1,
    });
    expect(mocks.posts.mock.lastCall?.[0].where.OR[1]).toEqual({
      scheduledAt: new Date(at),
    });
    await readWorkspaceCalendar(workspaceId, "user", {
      ...query,
      cursor: { id: `social:${postId}`, scheduledAt: at },
    });
    expect(mocks.posts.mock.lastCall?.[0].where.OR[1]).toEqual({
      scheduledAt: new Date(at),
      id: { gt: postId },
    });
    expect(mocks.tasks.mock.lastCall?.[0].where.AND.at(-1)).toEqual({
      OR: [{ effectiveScheduledAt: { gt: new Date(at) } }],
    });
  });
  it("keeps posts visible when the scheduler is deleted and there are no attachments", async () => {
    mocks.posts.mockResolvedValue([
      { ...post, scheduledByUser: null, media: [] },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      scheduledByName: null,
      attachmentCount: 0,
      projectName: "Launch project",
    });
  });
  it("scopes posts to the workspace, project, owner, and calendar range", async () => {
    await readWorkspaceCalendar(
      workspaceId,
      "user",
      { ...query, scope: "owned" },
      { projectId },
    );
    expect(mocks.posts.mock.lastCall?.[0].where).toEqual({
      workspaceId,
      projectId,
      scheduledByUserId: "user",
      status: { not: "DRAFT" },
      scheduledAt: { gte: query.from, lt: query.to },
    });
  });
  it.each([
    { includeSocialPosts: false },
    { assigneeId: "coworker" },
    { assigneeUserId: "user" },
    { status: "READY" as const },
  ])(
    "does not inject posts into task-only requests or task filters %j",
    async (overrides) => {
      await readWorkspaceCalendar(workspaceId, "user", {
        ...query,
        ...overrides,
      });
      expect(mocks.posts).not.toHaveBeenCalled();
    },
  );
  it("excludes posts from non-project sources", async () => {
    await readWorkspaceCalendar(workspaceId, "user", query, {
      sourceId: `workspace:${workspaceId}`,
    });
    expect(mocks.posts).not.toHaveBeenCalled();
  });
});
