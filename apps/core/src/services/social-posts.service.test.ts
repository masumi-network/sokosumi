import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectFindFirstMock,
  socialConnectionFindFirstMock,
  socialPostCreateMock,
  socialPostFindFirstMock,
  socialPostFindManyMock,
  socialPostUpdateManyMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  socialConnectionFindFirstMock: vi.fn(),
  socialPostCreateMock: vi.fn(),
  socialPostFindFirstMock: vi.fn(),
  socialPostFindManyMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    projectSocialConnection: { findFirst: socialConnectionFindFirstMock },
    socialPost: {
      create: socialPostCreateMock,
      findFirst: socialPostFindFirstMock,
      findMany: socialPostFindManyMock,
      updateMany: socialPostUpdateManyMock,
    },
  },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const SOCIAL_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_123";
const NOW = new Date("2026-09-15T10:00:00.000Z");
const FUTURE = new Date("2026-09-16T10:00:00.000Z");

const activeConnection = {
  id: SOCIAL_CONNECTION_ID,
  projectId: PROJECT_ID,
  provider: "x",
  externalHandle: "sokosumi",
  status: "active",
};

const draftPost = {
  id: POST_ID,
  createdAt: NOW,
  updatedAt: NOW,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  socialConnectionId: null,
  provider: "x",
  text: "Hello world",
  status: "DRAFT",
  scheduledAt: null,
  timezone: null,
  creatorUserId: USER_ID,
  creatorCoworkerId: null,
  creatorSokoBotId: null,
  scheduledByUserId: null,
  canceledAt: null,
  publishedAt: null,
  publishedExternalId: null,
  publishedUrl: null,
  lastError: null,
  attemptCount: 0,
  nextAttemptAt: null,
  leaseToken: null,
  leaseExpiresAt: null,
  lastAttemptAt: null,
  revision: 0,
  socialConnection: null,
  creatorUser: { id: USER_ID, name: "Ada Lovelace" },
  creatorCoworker: null,
  creatorSokoBot: null,
  attempts: [],
};

const scheduledPost = {
  ...draftPost,
  socialConnectionId: SOCIAL_CONNECTION_ID,
  status: "SCHEDULED",
  scheduledAt: FUTURE,
  timezone: "Europe/Zurich",
  scheduledByUserId: USER_ID,
  revision: 1,
  socialConnection: {
    id: SOCIAL_CONNECTION_ID,
    externalHandle: "sokosumi",
    status: "active",
  },
};

async function loadService() {
  return import("./social-posts.service");
}

describe("social posts service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    socialConnectionFindFirstMock.mockResolvedValue(activeConnection);
    socialPostFindManyMock.mockResolvedValue([draftPost]);
    socialPostFindFirstMock.mockResolvedValue(draftPost);
    socialPostCreateMock.mockResolvedValue(draftPost);
    socialPostUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("rejects a Project outside the current workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);
    const { listSocialPosts } = await loadService();

    await expect(
      listSocialPosts({ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }),
    ).rejects.toMatchObject({ status: 404, message: "Project not found" });

    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true },
    });
    expect(socialPostFindManyMock).not.toHaveBeenCalled();
  });

  it("lists posts scheduled-first with derived capability flags", async () => {
    const { listSocialPosts } = await loadService();

    const posts = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      statuses: ["DRAFT", "SCHEDULED"],
    });

    expect(socialPostFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          status: { in: ["DRAFT", "SCHEDULED"] },
        },
        orderBy: [
          { scheduledAt: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        take: 200,
      }),
    );
    expect(posts).toEqual([
      expect.objectContaining({
        id: POST_ID,
        provider: "x",
        status: "DRAFT",
        creator: { kind: "user", id: USER_ID, name: "Ada Lovelace" },
        socialConnection: null,
        canEdit: true,
        canSchedule: true,
        canCancel: true,
      }),
    ]);
  });

  it("loads the latest attempt with the post", async () => {
    const { getSocialPost } = await loadService();

    await getSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      postId: POST_ID,
    });

    expect(socialPostFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          attempts: expect.objectContaining({
            orderBy: { attempt: "desc" },
            take: 1,
          }),
        }),
      }),
    );
  });

  it("derives publish-now, reconnect, and last-attempt fields", async () => {
    const lastAttempt = {
      attempt: 2,
      trigger: "scheduler",
      outcome: "failed_transient",
      errorKind: "rate_limited",
      providerOutcome: "publish X post failed (429)",
      finishedAt: NOW,
    };
    socialPostFindManyMock.mockResolvedValue([
      {
        ...scheduledPost,
        attemptCount: 2,
        nextAttemptAt: FUTURE,
        lastAttemptAt: NOW,
        attempts: [lastAttempt],
        socialConnection: {
          ...scheduledPost.socialConnection,
          status: "reauthorization_required",
        },
      },
      { ...draftPost, status: "PUBLISHING" },
      { ...scheduledPost, status: "FAILED" },
      {
        ...scheduledPost,
        status: "PUBLISHED",
        socialConnection: {
          ...scheduledPost.socialConnection,
          status: "reauthorization_required",
        },
      },
    ]);
    const { listSocialPosts } = await loadService();

    const posts = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(posts[0]).toMatchObject({
      attemptCount: 2,
      nextAttemptAt: FUTURE,
      lastAttemptAt: NOW,
      lastAttempt,
      canPublishNow: true,
      connectionNeedsReconnect: true,
    });
    expect(posts[1]).toMatchObject({
      lastAttempt: null,
      canEdit: false,
      canCancel: false,
      canSchedule: false,
      canPublishNow: false,
      connectionNeedsReconnect: false,
    });
    expect(posts[2]).toMatchObject({
      canPublishNow: true,
      connectionNeedsReconnect: false,
    });
    expect(posts[3]).toMatchObject({
      canPublishNow: false,
      connectionNeedsReconnect: false,
    });
  });

  it("returns not found for a post in another Project", async () => {
    socialPostFindFirstMock.mockResolvedValue(null);
    const { getSocialPost } = await loadService();

    await expect(
      getSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        postId: POST_ID,
      }),
    ).rejects.toMatchObject({ status: 404, message: "Social post not found" });
  });

  it("creates a draft attributed to the interactive user", async () => {
    const { createSocialPost } = await loadService();

    const post = await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      text: "  Hello world  ",
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          socialConnectionId: null,
          provider: "x",
          text: "Hello world",
          status: "DRAFT",
          scheduledAt: null,
          timezone: null,
          creatorUserId: USER_ID,
          scheduledByUserId: null,
        },
      }),
    );
    expect(socialConnectionFindFirstMock).not.toHaveBeenCalled();
    expect(post).toMatchObject({ status: "DRAFT", canSchedule: true });
  });

  it("rejects text beyond the provider limit", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        text: "x".repeat(281),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("requires a social connection to create a scheduled post", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        text: "Hello world",
        scheduledAt: FUTURE,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "A social connection is required to schedule a post",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("requires a future time to create a scheduled post", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        text: "Hello world",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        scheduledAt: new Date(NOW.getTime() + 30_000),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Scheduled time must be in the future",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("requires an active connection to create a scheduled post", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...activeConnection,
      status: "reauthorization_required",
    });
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        text: "Hello world",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        scheduledAt: FUTURE,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Social connection is not active",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("creates a scheduled post through an active connection", async () => {
    socialPostCreateMock.mockResolvedValue(scheduledPost);
    const { createSocialPost } = await loadService();

    const post = await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      text: "Hello world",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt: FUTURE,
      timezone: "Europe/Zurich",
    });

    expect(socialConnectionFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOCIAL_CONNECTION_ID, projectId: PROJECT_ID },
      }),
    );
    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          socialConnectionId: SOCIAL_CONNECTION_ID,
          status: "SCHEDULED",
          scheduledAt: FUTURE,
          timezone: "Europe/Zurich",
          scheduledByUserId: USER_ID,
        }),
      }),
    );
    expect(post).toMatchObject({
      status: "SCHEDULED",
      socialConnection: { id: SOCIAL_CONNECTION_ID, status: "active" },
    });
  });

  it("maps a stale revision on update to a distinct conflict", async () => {
    socialPostUpdateManyMock.mockResolvedValue({ count: 0 });
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        text: "Edited",
        revision: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Social post was modified, reload and retry",
    });
  });

  it("rejects an update whose revision differs before writing", async () => {
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        text: "Edited",
        revision: 5,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Social post was modified, reload and retry",
    });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("updates a draft text and clears its connection with a revision bump", async () => {
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...draftPost,
        socialConnectionId: SOCIAL_CONNECTION_ID,
      })
      .mockResolvedValueOnce({ ...draftPost, text: "Edited", revision: 1 });
    const { updateSocialPost } = await loadService();

    const post = await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      text: "Edited",
      socialConnectionId: null,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 0 },
      data: {
        text: "Edited",
        socialConnectionId: null,
        revision: { increment: 1 },
      },
    });
    expect(post).toMatchObject({ text: "Edited", revision: 1 });
  });

  it("refuses to clear the connection of a scheduled post", async () => {
    socialPostFindFirstMock.mockResolvedValue(scheduledPost);
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        socialConnectionId: null,
        revision: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to edit a published post", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      status: "PUBLISHED",
    });
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        text: "Edited",
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["DRAFT", { ...draftPost, socialConnectionId: SOCIAL_CONNECTION_ID }],
    [
      "FAILED",
      {
        ...scheduledPost,
        status: "FAILED",
        lastError: "X rejected the post",
        revision: 3,
      },
    ],
  ])("schedules a %s post and clears its last error", async (_status, post) => {
    socialPostFindFirstMock.mockResolvedValueOnce(post).mockResolvedValueOnce({
      ...scheduledPost,
      revision: post.revision + 1,
    });
    const { scheduleSocialPost } = await loadService();

    const result = await scheduleSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      scheduledAt: FUTURE,
      timezone: "Europe/Zurich",
      revision: post.revision,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: post.revision },
      data: {
        status: "SCHEDULED",
        scheduledAt: FUTURE,
        timezone: "Europe/Zurich",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        scheduledByUserId: USER_ID,
        lastError: null,
        attemptCount: 0,
        nextAttemptAt: null,
        revision: { increment: 1 },
      },
    });
    expect(result).toMatchObject({
      status: "SCHEDULED",
      revision: post.revision + 1,
    });
  });

  it("refuses to schedule a draft without any connection", async () => {
    const { scheduleSocialPost } = await loadService();

    await expect(
      scheduleSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        scheduledAt: FUTURE,
        revision: 0,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "A social connection is required to schedule a post",
    });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to schedule a canceled post", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      status: "CANCELED",
      canceledAt: NOW,
    });
    const { scheduleSocialPost } = await loadService();

    await expect(
      scheduleSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        scheduledAt: FUTURE,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("cancels a scheduled post", async () => {
    socialPostFindFirstMock
      .mockResolvedValueOnce(scheduledPost)
      .mockResolvedValueOnce({
        ...scheduledPost,
        status: "CANCELED",
        canceledAt: NOW,
        revision: 2,
      });
    const { cancelSocialPost } = await loadService();

    const post = await cancelSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 1,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 1 },
      data: { status: "CANCELED", canceledAt: NOW, revision: { increment: 1 } },
    });
    expect(post).toMatchObject({
      status: "CANCELED",
      canEdit: false,
      canSchedule: false,
      canCancel: false,
    });
  });

  it("treats canceling an already canceled post as a no-op", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      status: "CANCELED",
      canceledAt: NOW,
      revision: 1,
    });
    const { cancelSocialPost } = await loadService();

    const post = await cancelSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    expect(post).toMatchObject({ status: "CANCELED", revision: 1 });
  });

  it("refuses to cancel a published post", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      status: "PUBLISHED",
      publishedAt: NOW,
    });
    const { cancelSocialPost } = await loadService();

    await expect(
      cancelSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });
});
