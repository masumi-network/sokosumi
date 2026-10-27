import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceCalendarQuery, readWorkspaceCalendar } from "./read";

const mocks = vi.hoisted(() => ({
  tasks: vi.fn(),
  taskCount: vi.fn(),
  runAtTasks: vi.fn(),
  runAtTaskCount: vi.fn(),
  posts: vi.fn(),
  postCount: vi.fn(),
  latestPost: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskScheduleRun: { findMany: mocks.tasks, count: mocks.taskCount },
    task: { findMany: mocks.runAtTasks, count: mocks.runAtTaskCount },
    socialPost: {
      findMany: mocks.posts,
      count: mocks.postCount,
      aggregate: mocks.latestPost,
    },
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
  provider: "x",
  text: "Launch",
  status: "SCHEDULED",
  revision: 4,
  scheduledAt: new Date(at),
  projectId,
  workspaceId,
  socialConnection: {
    externalHandle: "team",
    avatarUrl: "https://example.com/team.png",
  },
  project: { name: "Launch project" },
  scheduledByUser: { name: "Albina", image: "https://example.com/albina.png" },
  attempts: [],
  threadParts: [],
  quotedPostId: null,
  needsAttentionReason: null,
  publishedExternalId: null,
  publishingThreadPartPosition: null,
  lastError: null,
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
const run = {
  id: "00000000-0000-7000-8000-000000000001",
  originalScheduledAt: new Date(at),
  effectiveScheduledAt: new Date(at),
  state: "PLANNED",
  sourceWorkspaceId: workspaceId,
  sourceProjectId: projectId,
  sourceType: "PROJECT",
  schedule: {
    id: "44444444-4444-7444-8444-444444444444",
    name: "Prepare",
    ownerId: "user",
    state: "ACTIVE",
    revision: 2,
    creatorCoworkerId: null,
    assignee: null,
    assigneeId: null,
    assigneeUserId: null,
  },
  releasedTask: null,
};

describe("Social posts in the calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    mocks.tasks.mockResolvedValue([]);
    mocks.taskCount.mockResolvedValue(0);
    mocks.runAtTasks.mockResolvedValue([]);
    mocks.runAtTaskCount.mockResolvedValue(0);
    mocks.posts.mockResolvedValue([post]);
    mocks.postCount.mockResolvedValue(1);
    mocks.latestPost.mockResolvedValue({ _max: { scheduledAt: null } });
  });
  afterEach(() => vi.useRealTimers());
  it("merges tasks and posts with stable pagination at the same timestamp", async () => {
    mocks.tasks.mockResolvedValue([run]);
    mocks.taskCount.mockResolvedValue(1);
    const first = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(first.items[0]?.id).toBe(run.id);
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
      provider: "x",
      status: "SCHEDULED",
      revision: 4,
      lastAttempt: null,
      externalHandle: "team",
      avatarUrl: "https://example.com/team.png",
      projectName: "Launch project",
      scheduledByName: "Albina",
      scheduledByImage: "https://example.com/albina.png",
      attachmentCount: 1,
      previewMedia: {
        fileUrl: "https://example.com/launch.png",
        kind: "image",
      },
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
  it("includes the latest attempt outcome and error kind, never the provider error", async () => {
    mocks.posts.mockResolvedValue([
      {
        ...post,
        status: "FAILED",
        lastError: "X rejected the post (403): Duplicate content",
        attempts: [
          {
            outcome: "failed_permanent",
            errorKind: "rejected",
          },
        ],
      },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      status: "FAILED",
      lastAttempt: {
        outcome: "failed_permanent",
        errorKind: "rejected",
      },
    });
    expect(JSON.stringify(result.items[0])).not.toContain("403");
    expect(JSON.stringify(result.items[0])).not.toContain("Duplicate");
  });
  it("returns partial thread progress for calendar chips", async () => {
    mocks.posts.mockResolvedValue([
      {
        ...post,
        status: "FAILED",
        publishedExternalId: "1907",
        threadParts: [
          { position: 2, externalPostId: null, error: "Thread part 2 failed" },
          { position: 3, externalPostId: null, error: null },
        ],
      },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      threadPartCount: 3,
      publishedThreadPartCount: 1,
      failedThreadPartPosition: 2,
      partiallyPublished: true,
    });
  });

  it("returns the quote indicator and attention reason for calendar items", async () => {
    mocks.posts.mockResolvedValue([
      {
        ...post,
        status: "FAILED",
        quotedPostId: "77777777-7777-4777-8777-777777777777",
        needsAttentionReason: "The post it quotes failed to publish",
      },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      quotedPostId: "77777777-7777-4777-8777-777777777777",
      needsAttentionReason: "The post it quotes failed to publish",
    });
  });

  it("derives the waiting state for a due quote whose target is not live", async () => {
    vi.setSystemTime(new Date(at));
    mocks.posts.mockResolvedValue([
      {
        ...post,
        quotedPostId: "77777777-7777-4777-8777-777777777777",
        quotedPost: { status: "SCHEDULED", publishedExternalId: null },
      },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      waitingForQuotedPost: true,
      status: "SCHEDULED",
    });
  });

  it("keeps posts visible when the scheduler is deleted and there are no attachments", async () => {
    mocks.posts.mockResolvedValue([
      { ...post, scheduledByUser: null, media: [] },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      scheduledByName: null,
      scheduledByImage: null,
      avatarUrl: "https://example.com/team.png",
      attachmentCount: 0,
      previewMedia: null,
      projectName: "Launch project",
    });
  });
  it("keeps the calendar item when the account has no photo", async () => {
    mocks.posts.mockResolvedValue([
      {
        ...post,
        socialConnection: { externalHandle: "team", avatarUrl: null },
      },
    ]);
    const result = await readWorkspaceCalendar(workspaceId, "user", query);
    expect(result.items[0]).toMatchObject({
      externalHandle: "team",
      avatarUrl: null,
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
  it("bounds agenda posts to NEEDS_APPROVAL/SCHEDULED/PUBLISHING instead of fetching history", async () => {
    await readWorkspaceCalendar(workspaceId, "user", {
      ...query,
      agendaOnly: true,
    });
    expect(mocks.posts.mock.lastCall?.[0].where).toEqual({
      workspaceId,
      status: { in: ["NEEDS_APPROVAL", "SCHEDULED", "PUBLISHING"] },
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

  it.each(["SCHEDULED", "PUBLISHING"])(
    "allows the full padded month of a far-future %s post",
    async (status) => {
      mocks.latestPost.mockResolvedValue({
        _max: { scheduledAt: new Date("2027-01-20T12:00:00.000Z") },
      });
      mocks.posts.mockResolvedValue([
        {
          ...post,
          status,
          scheduledAt: new Date("2027-01-20T12:00:00.000Z"),
        },
      ]);
      const farFutureQuery = parseWorkspaceCalendarQuery({
        from: "2026-12-26T08:00:00.000Z",
        to: "2027-02-09T11:59:59.999Z",
        includeSocialPosts: "true",
        scope: "owned",
        limit: 100,
      });
      await expect(
        readWorkspaceCalendar(workspaceId, "user", farFutureQuery, {
          projectId,
        }),
      ).resolves.toMatchObject({
        items: [
          {
            kind: "socialPost",
            status,
            scheduledAt: "2027-01-20T12:00:00.000Z",
          },
        ],
      });
      expect(mocks.latestPost).toHaveBeenCalledWith({
        where: {
          workspaceId,
          projectId,
          scheduledByUserId: "user",
          status: { in: ["SCHEDULED", "PUBLISHING"] },
          scheduledAt: { not: null },
        },
        _max: { scheduledAt: true },
      });
    },
  );

  it("rejects ranges beyond the latest scheduled post's padded month grid", async () => {
    mocks.latestPost.mockResolvedValue({
      _max: { scheduledAt: new Date("2027-01-20T12:00:00.000Z") },
    });
    await expect(
      readWorkspaceCalendar(workspaceId, "user", {
        ...query,
        from: new Date("2027-01-01T00:00:00.000Z"),
        to: new Date("2027-02-09T12:00:00.000Z"),
      }),
    ).rejects.toThrow("Calendar browse range cannot extend");
    expect(mocks.tasks).not.toHaveBeenCalled();
  });

  it("keeps the default horizon when there is no qualifying post", async () => {
    await expect(
      readWorkspaceCalendar(workspaceId, "user", {
        ...query,
        from: new Date("2027-01-01T00:00:00.000Z"),
        to: new Date("2027-02-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Calendar browse range cannot extend");
    expect(mocks.posts).not.toHaveBeenCalled();
  });

  it.each([
    [{ includeSocialPosts: false }, {}],
    [{ assigneeId: "coworker" }, {}],
    [{ assigneeUserId: "user" }, {}],
    [{ status: "READY" as const }, {}],
    [{}, { sourceId: `workspace:${workspaceId}` }],
  ])(
    "does not extend a calendar that excludes social posts %j",
    async (filters, options) => {
      await expect(
        readWorkspaceCalendar(
          workspaceId,
          "user",
          {
            ...query,
            ...filters,
            from: new Date("2027-01-01T00:00:00.000Z"),
            to: new Date("2027-02-01T00:00:00.000Z"),
          },
          options,
        ),
      ).rejects.toThrow("Calendar browse range cannot extend");
      expect(mocks.latestPost).not.toHaveBeenCalled();
    },
  );
});
