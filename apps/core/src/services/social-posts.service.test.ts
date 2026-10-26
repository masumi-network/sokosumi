import { SOCIAL_POST_MIN_SCHEDULE_LEAD_MS } from "@sokosumi/utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";

const {
  projectFindFirstMock,
  socialConnectionFindFirstMock,
  socialAccountPostFindFirstMock,
  socialPostCreateMock,
  socialPostFindFirstMock,
  socialPostFindManyMock,
  socialPostCountMock,
  socialPostUpdateManyMock,
  transactionMock,
  queryRawMock,
  resolveXSubscriptionTypeMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  socialConnectionFindFirstMock: vi.fn(),
  socialAccountPostFindFirstMock: vi.fn(),
  socialPostCreateMock: vi.fn(),
  socialPostFindFirstMock: vi.fn(),
  socialPostFindManyMock: vi.fn(),
  socialPostCountMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
  resolveXSubscriptionTypeMock: vi.fn(),
}));

vi.mock("@/services/x-subscription-tier.service", () => ({
  resolveXSubscriptionType: resolveXSubscriptionTypeMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    $queryRaw: queryRawMock,
    project: { findFirst: projectFindFirstMock },
    projectSocialConnection: { findFirst: socialConnectionFindFirstMock },
    socialAccountPost: { findFirst: socialAccountPostFindFirstMock },
    socialPost: {
      create: socialPostCreateMock,
      findFirst: socialPostFindFirstMock,
      findMany: socialPostFindManyMock,
      count: socialPostCountMock,
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
  subscriptionType: null,
  status: "active",
};

const ORG_ID = "org_123";
const IMAGE_REF = {
  pathname: `drive/users/${USER_ID}/launch.png`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/launch.png`,
  name: "launch.png",
  size: 240_000,
  mimeType: "image/png",
  kind: "image" as const,
};
const ORG_IMAGE_REF = {
  ...IMAGE_REF,
  pathname: `drive/organizations/${ORG_ID}/team photo.jpg`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/organizations/${ORG_ID}/team%20photo.jpg`,
  name: "team photo.jpg",
  mimeType: "image/jpeg",
};
const GIF_REF = {
  ...IMAGE_REF,
  pathname: `drive/users/${USER_ID}/loop.gif`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/loop.gif`,
  name: "loop.gif",
  mimeType: "image/gif",
  kind: "gif" as const,
};
const JPEG_REF = {
  ...IMAGE_REF,
  pathname: `drive/users/${USER_ID}/launch.jpg`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/launch.jpg`,
  name: "launch.jpg",
  mimeType: "image/jpeg",
};
const VIDEO_REF = {
  ...IMAGE_REF,
  pathname: `drive/users/${USER_ID}/clip.mp4`,
  fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/clip.mp4`,
  name: "clip.mp4",
  mimeType: "video/mp4",
  kind: "video" as const,
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
  firstComment: null,
  media: [],
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
  beforeAll(async () => {
    await loadService();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resolveXSubscriptionTypeMock.mockImplementation(
      async (connection) => connection.subscriptionType ?? null,
    );
    transactionMock.mockImplementation(async (callback) =>
      callback({ ...prisma }),
    );
    queryRawMock.mockResolvedValue([{ id: PROJECT_ID }]);
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    socialConnectionFindFirstMock.mockResolvedValue(activeConnection);
    socialPostFindManyMock.mockResolvedValue([draftPost]);
    socialPostCountMock.mockResolvedValue(1);
    socialPostFindFirstMock.mockResolvedValue(draftPost);
    socialPostCreateMock.mockResolvedValue(draftPost);
    socialPostUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it.each([
    ["Basic", true],
    ["Premium", true],
    ["PremiumPlus", true],
    ["None", false],
    [null, false],
  ])(
    "validates long X drafts for tier %s",
    async (subscriptionType, accepted) => {
      socialConnectionFindFirstMock.mockResolvedValue({
        ...activeConnection,
        subscriptionType,
      });
      const { createSocialPost } = await loadService();
      const result = createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        organizationId: null,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        text: "x".repeat(5000),
      });
      if (accepted) {
        await result;
        expect(socialPostCreateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ text: "x".repeat(5000) }),
          }),
        );
      } else {
        await expect(result).rejects.toMatchObject({
          message: "Text must be at most 280 characters for X",
        });
        expect(socialPostCreateMock).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects X text above the Premium limit with the formatted limit", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...activeConnection,
      subscriptionType: "Premium",
    });
    const { createSocialPost } = await loadService();
    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        organizationId: null,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        text: "x".repeat(25_001),
      }),
    ).rejects.toMatchObject({
      message: "Text must be at most 25,000 characters for X",
    });
  });

  it("allows 300 raw characters when a URL puts the weighted length below 280", async () => {
    const text = `${"x".repeat(220)} https://example.com/${"p".repeat(59)}`;
    expect(text.length).toBe(300);
    const { createSocialPost } = await loadService();
    await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      socialConnectionId: SOCIAL_CONNECTION_ID,
      text,
      firstComment: text,
    });
    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text, firstComment: text }),
      }),
    );
  });

  it("allows long first comments for a freshly upgraded Basic account", async () => {
    resolveXSubscriptionTypeMock.mockResolvedValue("Basic");
    const { createSocialPost } = await loadService();
    await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      socialConnectionId: SOCIAL_CONNECTION_ID,
      text: "Hello",
      firstComment: "x".repeat(5000),
    });
    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstComment: "x".repeat(5000) }),
      }),
    );
  });

  it.each(["create", "update", "schedule", "duplicate"] as const)(
    "validates %s against a refreshed downgrade",
    async (action) => {
      const connection = { ...activeConnection, subscriptionType: "Premium" };
      socialConnectionFindFirstMock.mockResolvedValue(connection);
      socialPostFindFirstMock.mockResolvedValue({
        ...draftPost,
        text: "x".repeat(5000),
        status: action === "duplicate" ? "PUBLISHED" : "DRAFT",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        socialConnection: connection,
      });
      resolveXSubscriptionTypeMock.mockResolvedValue("None");
      const service = await loadService();
      const scope = {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        organizationId: null,
        postId: POST_ID,
        revision: 0,
      };
      const result =
        action === "create"
          ? service.createSocialPost({
              ...scope,
              socialConnectionId: SOCIAL_CONNECTION_ID,
              text: "x".repeat(5000),
            })
          : action === "update"
            ? service.updateSocialPost({
                ...scope,
                firstComment: "Only editing the comment",
              })
            : action === "schedule"
              ? service.scheduleSocialPost({ ...scope, scheduledAt: FUTURE })
              : service.duplicateSocialPost(scope);
      await expect(result).rejects.toMatchObject({
        message: "Text must be at most 280 characters for X",
      });
      expect(resolveXSubscriptionTypeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SOCIAL_CONNECTION_ID,
          subscriptionType: "Premium",
        }),
      );
      expect(socialPostCreateMock).not.toHaveBeenCalled();
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([null, "None"])(
    "revalidates text when switching from Premium to tier %s",
    async (subscriptionType) => {
      socialPostFindFirstMock.mockResolvedValue({
        ...draftPost,
        text: "x".repeat(1000),
        socialConnectionId: SOCIAL_CONNECTION_ID,
        socialConnection: { ...activeConnection, subscriptionType: "Premium" },
      });
      socialConnectionFindFirstMock.mockResolvedValue({
        ...activeConnection,
        subscriptionType,
      });
      const { updateSocialPost } = await loadService();
      await expect(
        updateSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          organizationId: null,
          postId: POST_ID,
          revision: 0,
          socialConnectionId: "other-connection",
        }),
      ).rejects.toMatchObject({
        message: "Text must be at most 280 characters for X",
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["update", "schedule", "duplicate"] as const)(
    "allows long Premium X text through %s",
    async (action) => {
      const connection = { ...activeConnection, subscriptionType: "Premium" };
      socialConnectionFindFirstMock.mockResolvedValue(connection);
      socialPostFindFirstMock.mockResolvedValue({
        ...draftPost,
        text: "x".repeat(1000),
        status: action === "duplicate" ? "PUBLISHED" : "DRAFT",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        socialConnection: connection,
      });
      const service = await loadService();
      const input = {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        organizationId: null,
        postId: POST_ID,
        revision: 0,
      };
      if (action === "update")
        await service.updateSocialPost({ ...input, text: "x".repeat(1000) });
      if (action === "schedule")
        await service.scheduleSocialPost({ ...input, scheduledAt: FUTURE });
      if (action === "duplicate") await service.duplicateSocialPost(input);
      expect(
        action === "duplicate"
          ? socialPostCreateMock
          : socialPostUpdateManyMock,
      ).toHaveBeenCalled();
    },
  );

  describe.each(["closingAt", "closedAt"] as const)(
    "a Project with %s",
    (field) => {
      beforeEach(() => {
        projectFindFirstMock.mockResolvedValue({
          id: PROJECT_ID,
          [field]: NOW,
        });
      });

      it.each(["DRAFT", "NEEDS_APPROVAL", "SCHEDULED", "FAILED", "MISSED"])(
        "rejects scheduling or rescheduling a %s post",
        async (status) => {
          socialPostFindFirstMock.mockResolvedValue({
            ...scheduledPost,
            status,
          });
          const { scheduleSocialPost } = await loadService();

          await expect(
            scheduleSocialPost({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              postId: POST_ID,
              revision: 1,
              scheduledAt: FUTURE,
            }),
          ).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining("closing or closed Project"),
          });
          expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
          expect(socialConnectionFindFirstMock).not.toHaveBeenCalled();
        },
      );

      it.each([null, FUTURE])(
        "rejects approval with scheduledAt %s",
        async (scheduledAt) => {
          socialPostFindFirstMock.mockResolvedValue({
            ...scheduledPost,
            status: "NEEDS_APPROVAL",
            scheduledAt,
          });
          const { approveSocialPost } = await loadService();

          await expect(
            approveSocialPost({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              postId: POST_ID,
              revision: 1,
            }),
          ).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining("closing or closed Project"),
          });
          expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
        },
      );

      it.each([{}, { coworkerId: "cow_123" }, { sokoBotId: "bot_123" }])(
        "rejects direct scheduled creation by %j",
        async (actor) => {
          const { createSocialPost } = await loadService();
          await expect(
            createSocialPost({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              organizationId: null,
              userId: USER_ID,
              text: "Hello",
              scheduledAt: FUTURE,
              socialConnectionId: SOCIAL_CONNECTION_ID,
              ...actor,
            }),
          ).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining("closing or closed Project"),
          });
          expect(socialPostCreateMock).not.toHaveBeenCalled();
        },
      );

      it("rejects edits to a scheduled post before changing its retry or scheduling state", async () => {
        socialPostFindFirstMock.mockResolvedValue(scheduledPost);
        const { updateSocialPost } = await loadService();
        await expect(
          updateSocialPost({
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            organizationId: null,
            userId: USER_ID,
            postId: POST_ID,
            revision: 1,
            text: "Edited",
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
      });

      it("rejects scheduled recycling before creating a duplicate draft", async () => {
        const { recycleSocialAccountPost } = await loadService();
        await expect(
          recycleSocialAccountPost({
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            organizationId: null,
            userId: USER_ID,
            accountPostId: "account-post-1",
            delayDays: 7,
            timezone: "UTC",
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(socialPostCreateMock).not.toHaveBeenCalled();
        expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
      });

      it("still allows saving a draft", async () => {
        const { createSocialPost } = await loadService();
        const post = await createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
        });
        expect(post.status).toBe("DRAFT");
      });
    },
  );

  it("rejects a Project outside the current workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);
    const { listSocialPosts } = await loadService();

    await expect(
      listSocialPosts({ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }),
    ).rejects.toMatchObject({ status: 404, message: "Project not found" });

    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true, closingAt: true, closedAt: true },
    });
    expect(socialPostFindManyMock).not.toHaveBeenCalled();
  });

  it("lists a bounded page with derived capability flags", async () => {
    const { listSocialPosts } = await loadService();

    const { posts } = await listSocialPosts({
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
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 21,
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
        canPublishNow: true,
        canApprove: false,
        canReject: false,
        canDuplicate: false,
      }),
    ]);
  });

  it.each([["FAILED"], ["MISSED"], ["FAILED", "MISSED"]] as const)(
    "orders %s by last attempt, then scheduled time",
    async (...statuses) => {
      const { listSocialPosts } = await loadService();

      await listSocialPosts({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        statuses: [...statuses],
      });

      expect(socialPostFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            status: { in: [...statuses] },
          },
          orderBy: [
            { lastAttemptAt: { sort: "desc", nulls: "last" } },
            { scheduledAt: { sort: "desc", nulls: "last" } },
            { id: "desc" },
          ],
        }),
      );
    },
  );

  it("paginates a filtered section independently of its history", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...draftPost,
      id: `post-${index}`,
    }));
    socialPostFindManyMock.mockResolvedValue(rows);
    socialPostCountMock.mockResolvedValue(25);
    const { listSocialPosts } = await loadService();
    const result = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      statuses: ["DRAFT"],
      cursor: "previous",
      limit: 20,
    });
    expect(result.posts).toHaveLength(20);
    expect(result.pagination).toEqual({
      cursor: "previous",
      limit: 20,
      total: 25,
      nextCursor: "post-19",
    });
    expect(socialPostFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          status: { in: ["DRAFT"] },
        },
        cursor: { id: "previous" },
        skip: 1,
        take: 21,
      }),
    );
    socialPostFindManyMock.mockResolvedValue(rows.slice(0, 5));
    const last = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      statuses: ["DRAFT"],
      cursor: "post-19",
      limit: 20,
    });
    expect(last.pagination.nextCursor).toBeNull();
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

    const { posts } = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(posts[0]).toMatchObject({
      attemptCount: 2,
      nextAttemptAt: FUTURE,
      lastAttemptAt: NOW,
      lastAttempt,
      canPublishNow: true,
      canDuplicate: false,
      connectionNeedsReconnect: true,
    });
    expect(posts[1]).toMatchObject({
      lastAttempt: null,
      canEdit: false,
      canCancel: false,
      canSchedule: false,
      canPublishNow: false,
      canDuplicate: false,
      connectionNeedsReconnect: false,
    });
    expect(posts[2]).toMatchObject({
      canPublishNow: true,
      canDuplicate: true,
      connectionNeedsReconnect: false,
    });
    expect(posts[3]).toMatchObject({
      canPublishNow: false,
      canDuplicate: true,
      connectionNeedsReconnect: false,
    });
  });

  it("marks a needs-approval post as approvable, not publishable", async () => {
    socialPostFindManyMock.mockResolvedValue([
      { ...draftPost, status: "NEEDS_APPROVAL" },
    ]);
    const { listSocialPosts } = await loadService();

    const { posts } = await listSocialPosts({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(posts[0]).toMatchObject({
      status: "NEEDS_APPROVAL",
      canEdit: true,
      canSchedule: true,
      canCancel: true,
      canPublishNow: false,
      canApprove: true,
      canReject: true,
    });
  });

  it.each([
    { provider: "instagram", media: [], canPublishNow: false },
    { provider: "tiktok", media: [], canPublishNow: false },
    { provider: "youtube", media: [], canPublishNow: false },
    { provider: "tiktok", media: [VIDEO_REF], canPublishNow: true },
    { provider: "instagram", media: [JPEG_REF], canPublishNow: true },
    { provider: "x", media: [], canPublishNow: true },
  ] as const)(
    "sets canPublishNow $canPublishNow on a $provider draft",
    async ({ provider, media, canPublishNow }) => {
      socialPostFindManyMock.mockResolvedValue([
        { ...draftPost, provider, media },
      ]);
      const { listSocialPosts } = await loadService();

      const { posts } = await listSocialPosts({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });

      expect(posts[0]).toMatchObject({ canPublishNow });
    },
  );

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

  it.each([
    ["tiktok", [VIDEO_REF]],
    ["instagram", [JPEG_REF]],
    ["linkedin", []],
    ["facebook", []],
    ["youtube", [VIDEO_REF]],
  ] as const)(
    "accepts a %s connection and stores the provider",
    async (provider, media) => {
      socialConnectionFindFirstMock.mockResolvedValue({
        ...activeConnection,
        provider,
      });
      const { createSocialPost } = await loadService();

      await createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        text: "Hello",
        media: [...media],
      });

      expect(socialPostCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider }),
        }),
      );
    },
  );

  it.each(["instagram", "tiktok", "youtube"] as const)(
    "saves a %s draft without media",
    async (provider) => {
      socialConnectionFindFirstMock.mockResolvedValue({
        ...activeConnection,
        provider,
      });
      const { createSocialPost } = await loadService();

      await createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        text: "Hello",
      });

      expect(socialPostCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider,
            text: "Hello",
            status: "DRAFT",
          }),
        }),
      );
    },
  );

  it.each([
    ["instagram", "Instagram requires at least one image or video"],
    ["tiktok", "TikTok requires a video"],
    ["youtube", "YouTube requires a video"],
  ] as const)(
    "still requires media to schedule a %s post",
    async (provider, message) => {
      socialConnectionFindFirstMock.mockResolvedValue({
        ...activeConnection,
        provider,
      });
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          socialConnectionId: SOCIAL_CONNECTION_ID,
          text: "Hello",
          scheduledAt: FUTURE,
          timezone: "Europe/Zurich",
        }),
      ).rejects.toMatchObject({
        status: 400,
        message,
      });
      expect(socialPostCreateMock).not.toHaveBeenCalled();
    },
  );

  it("requires text for a linkedin post", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...activeConnection,
      provider: "linkedin",
    });
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        text: "   ",
        media: [JPEG_REF],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "LinkedIn requires text",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("moves a text draft onto Instagram without media", async () => {
    const instagramConnection = {
      ...activeConnection,
      provider: "instagram",
    };
    socialConnectionFindFirstMock.mockResolvedValue(instagramConnection);
    const { updateSocialPost } = await loadService();

    await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
      socialConnectionId: SOCIAL_CONNECTION_ID,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "instagram",
          socialConnectionId: SOCIAL_CONNECTION_ID,
        }),
      }),
    );
  });

  it("refuses to strip media from a scheduled Instagram post", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...scheduledPost,
      provider: "instagram",
      media: [JPEG_REF],
    });
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        postId: POST_ID,
        media: [],
        revision: 1,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Instagram requires at least one image or video",
    });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("re-derives the provider when the connection moves to another platform", async () => {
    const linkedinConnection = { ...activeConnection, provider: "linkedin" };
    socialConnectionFindFirstMock.mockResolvedValue(linkedinConnection);
    const { updateSocialPost } = await loadService();

    await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
      socialConnectionId: SOCIAL_CONNECTION_ID,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "linkedin",
          socialConnectionId: SOCIAL_CONNECTION_ID,
        }),
      }),
    );
  });

  it("refuses to schedule a post that no longer meets its provider rules", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...activeConnection,
      provider: "youtube",
    });
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      provider: "youtube",
    });
    const { scheduleSocialPost } = await loadService();

    await expect(
      scheduleSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        revision: 0,
        scheduledAt: FUTURE,
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "YouTube requires a video",
    });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
  });

  it("creates a draft attributed to the interactive user", async () => {
    const { createSocialPost } = await loadService();

    const post = await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
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
          firstComment: null,
          media: [],
          status: "DRAFT",
          scheduledAt: null,
          timezone: null,
          creatorUserId: USER_ID,
          creatorCoworkerId: null,
          creatorSokoBotId: null,
          scheduledByUserId: null,
          scheduledByCoworkerId: null,
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
        organizationId: null,
        userId: USER_ID,
        text: "x".repeat(281),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("stores a first comment on create", async () => {
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      firstComment: "#launch",
    });
    const { createSocialPost } = await loadService();

    const post = await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      text: "Hello world",
      firstComment: " #launch ",
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstComment: "#launch" }),
      }),
    );
    expect(post.firstComment).toBe("#launch");
  });

  it("rejects a first comment beyond the provider limit", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        text: "Hello world",
        firstComment: "x".repeat(281),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "First comment must be at most 280 characters for x",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("requires a social connection to create a scheduled post", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
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
        organizationId: null,
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

  it("rejects a scheduled time exactly one minute out", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        text: "Hello world",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        scheduledAt: new Date(NOW.getTime() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Scheduled time must be in the future",
    });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it("accepts the first instant after the one-minute lead", async () => {
    const scheduledAt = new Date(
      NOW.getTime() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS + 1,
    );
    socialPostCreateMock.mockResolvedValue({
      ...scheduledPost,
      scheduledAt,
    });
    const { createSocialPost } = await loadService();

    await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      text: "Hello world",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SCHEDULED",
          scheduledAt,
        }),
      }),
    );
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
        organizationId: null,
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
      organizationId: null,
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

  describe("media", () => {
    it("stores normalized Drive refs from the personal workspace", async () => {
      socialPostCreateMock.mockResolvedValue({
        ...draftPost,
        media: [IMAGE_REF],
      });
      const { createSocialPost } = await loadService();

      const post = await createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        text: "",
        media: [{ ...IMAGE_REF, mimeType: " IMAGE/PNG " }],
      });

      expect(socialPostCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ text: "", media: [IMAGE_REF] }),
        }),
      );
      expect(post.media).toEqual([IMAGE_REF]);
    });

    it("accepts organization Drive refs in that organization's workspace", async () => {
      const { createSocialPost } = await loadService();

      await createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        text: "Team",
        media: [ORG_IMAGE_REF],
      });

      expect(socialPostCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ media: [ORG_IMAGE_REF] }),
        }),
      );
    });

    it("rejects a personal Drive ref from an organization workspace", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          text: "Hello",
          media: [IMAGE_REF],
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(socialPostCreateMock).not.toHaveBeenCalled();
    });

    it("rejects another organization's Drive ref", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: "org_other",
          userId: USER_ID,
          text: "Hello",
          media: [ORG_IMAGE_REF],
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("rejects a pathname outside Drive", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [
            {
              ...IMAGE_REF,
              pathname: "tasks/tsk_1/launch.png",
              fileUrl:
                "https://store.public.blob.vercel-storage.com/tasks/tsk_1/launch.png",
            },
          ],
        }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it.each([
      [
        "a foreign host",
        "https://evil.example/drive/users/user_123/launch.png",
      ],
      [
        "plain http",
        `http://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/launch.png`,
      ],
      [
        "a URL for a different file",
        `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/other.png`,
      ],
    ])("rejects a file URL on %s", async (_name, fileUrl) => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [{ ...IMAGE_REF, fileUrl }],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Media file "launch.png" is not a Drive file',
      });
    });

    it("rejects an unsupported or mismatched type", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [{ ...IMAGE_REF, mimeType: "image/svg+xml" }],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Media file "launch.png" is not a file type X accepts',
      });
      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [{ ...GIF_REF, kind: "image" }],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Media file "loop.gif" is not a file type X accepts',
      });
    });

    it("applies the X media rules", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [IMAGE_REF, GIF_REF],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: "X does not allow a post that mixes images, a GIF, or a video",
      });
      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "Hello",
          media: [{ ...IMAGE_REF, size: 5 * 1024 * 1024 + 1 }],
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: "A file is too large for X",
      });
      expect(socialPostCreateMock).not.toHaveBeenCalled();
    });

    it("still requires text when no media is attached", async () => {
      const { createSocialPost } = await loadService();

      await expect(
        createSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          text: "   ",
          media: [],
        }),
      ).rejects.toMatchObject({ status: 400, message: "Text is required" });
    });

    it("replaces media on update and re-checks the text rule", async () => {
      socialPostFindFirstMock
        .mockResolvedValueOnce({ ...draftPost, text: "", media: [IMAGE_REF] })
        .mockResolvedValueOnce({ ...draftPost, media: [GIF_REF], revision: 1 });
      const { updateSocialPost } = await loadService();

      await updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        postId: POST_ID,
        media: [GIF_REF],
        revision: 0,
      });

      expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
        where: { id: POST_ID, revision: 0 },
        data: { media: [GIF_REF], text: "", revision: { increment: 1 } },
      });
    });

    it("refuses to drop the media of a text-less post", async () => {
      socialPostFindFirstMock.mockResolvedValue({
        ...draftPost,
        text: "",
        media: [IMAGE_REF],
      });
      const { updateSocialPost } = await loadService();

      await expect(
        updateSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          postId: POST_ID,
          media: [],
          revision: 0,
        }),
      ).rejects.toMatchObject({ status: 400, message: "Text is required" });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    });

    it("treats malformed stored media as none", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      socialPostFindManyMock.mockResolvedValue([
        { ...draftPost, media: [{ pathname: 1 }] },
      ]);
      const { listSocialPosts } = await loadService();

      const { posts } = await listSocialPosts({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });

      expect(posts[0].media).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("media"),
        { postId: POST_ID },
      );
    });

    it("enforces the media rules when scheduling", async () => {
      socialPostFindFirstMock.mockResolvedValue({
        ...draftPost,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        media: [IMAGE_REF, GIF_REF],
      });
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
        message: "X does not allow a post that mixes images, a GIF, or a video",
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  it("maps a stale revision on update to a distinct conflict", async () => {
    socialPostUpdateManyMock.mockResolvedValue({ count: 0 });
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        postId: POST_ID,
        text: "Edited",
        revision: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Social post was modified, reload and retry",
      cause: { kind: "social_post_revision_conflict" },
    });
  });

  it("rejects an update whose revision differs before writing", async () => {
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        postId: POST_ID,
        text: "Edited",
        revision: 5,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Social post was modified, reload and retry",
      cause: { kind: "social_post_revision_conflict" },
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
      organizationId: null,
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

  it("updates a draft first comment", async () => {
    socialPostFindFirstMock
      .mockResolvedValueOnce(draftPost)
      .mockResolvedValueOnce({
        ...draftPost,
        firstComment: "#launch",
        revision: 1,
      });
    const { updateSocialPost } = await loadService();

    const post = await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      postId: POST_ID,
      firstComment: " #launch ",
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 0 },
      data: {
        firstComment: "#launch",
        revision: { increment: 1 },
      },
    });
    expect(post.firstComment).toBe("#launch");
  });

  it("refuses to clear the connection of a scheduled post", async () => {
    socialPostFindFirstMock.mockResolvedValue(scheduledPost);
    const { updateSocialPost } = await loadService();

    await expect(
      updateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
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
        organizationId: null,
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
        scheduledByCoworkerId: null,
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

  it.each(["FAILED", "MISSED"] as const)(
    "cancels a %s post",
    async (status) => {
      socialPostFindFirstMock
        .mockResolvedValueOnce({
          ...scheduledPost,
          status,
          lastError: "X rejected the post",
        })
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
        data: {
          status: "CANCELED",
          canceledAt: NOW,
          revision: { increment: 1 },
        },
      });
      expect(post).toMatchObject({
        status: "CANCELED",
        canEdit: false,
        canSchedule: false,
        canCancel: false,
      });
    },
  );

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
  it("records a coworker creator and contextual scheduling user separately", async () => {
    const { createSocialPost } = await loadService();
    await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      coworkerId: "cow_123",
      text: "Hello",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt: new Date(NOW.getTime() + 120_000),
    });
    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_APPROVAL",
          creatorUserId: null,
          creatorCoworkerId: "cow_123",
          scheduledByUserId: USER_ID,
          scheduledByCoworkerId: "cow_123",
        }),
      }),
    );
  });
  it("records a bot creator while retaining its owner's scheduling authority", async () => {
    const sokoBotId = "55555555-5555-4555-8555-555555555555";
    socialPostCreateMock.mockResolvedValue({
      ...scheduledPost,
      creatorUserId: null,
      creatorUser: null,
      creatorSokoBotId: sokoBotId,
      creatorSokoBot: { id: sokoBotId, name: "Soko" },
    });
    const { createSocialPost } = await loadService();

    const post = await createSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      sokoBotId,
      text: "Hello",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt: FUTURE,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_APPROVAL",
          creatorUserId: null,
          creatorCoworkerId: null,
          creatorSokoBotId: sokoBotId,
          scheduledByUserId: USER_ID,
          scheduledByCoworkerId: null,
        }),
      }),
    );
    expect(post.creator).toEqual({
      kind: "sokoBot",
      id: sokoBotId,
      name: "Soko",
    });
  });

  it("rejects conflicting bot and coworker authorship before writing", async () => {
    const { createSocialPost } = await loadService();

    await expect(
      createSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        coworkerId: "cow_123",
        sokoBotId: "55555555-5555-4555-8555-555555555555",
        text: "Hello",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(socialPostCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    "createSocialPost",
    "updateSocialPost",
    "scheduleSocialPost",
    "cancelSocialPost",
    "getSocialPost",
  ] as const)(
    "keeps every %s query inside the supplied transaction",
    async (operation) => {
      const savedPost = { ...scheduledPost, revision: 2 };
      const tx = {
        ...prisma,
        project: {
          ...prisma.project,
          findFirst: vi.fn().mockResolvedValue({ id: PROJECT_ID }),
        },
        projectSocialConnection: {
          ...prisma.projectSocialConnection,
          findFirst: vi.fn().mockResolvedValue(activeConnection),
        },
        socialPost: {
          ...prisma.socialPost,
          create: vi.fn().mockResolvedValue(savedPost),
          findFirst: vi.fn().mockResolvedValue(savedPost),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      if (operation !== "getSocialPost") {
        tx.socialPost.findFirst.mockResolvedValueOnce(draftPost);
      }
      const service = await loadService();

      const post = await service[operation](
        {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          postId: POST_ID,
          text: "Hello",
          media: [IMAGE_REF],
          socialConnectionId: SOCIAL_CONNECTION_ID,
          scheduledAt: FUTURE,
          revision: 0,
        },
        tx,
      );

      expect(post.revision).toBe(2);
      expect(tx.project.findFirst).toHaveBeenCalledWith({
        where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
        select: { id: true, closingAt: true, closedAt: true },
      });
      expect(projectFindFirstMock).not.toHaveBeenCalled();
      expect(socialConnectionFindFirstMock).not.toHaveBeenCalled();
      expect(socialPostFindFirstMock).not.toHaveBeenCalled();
      expect(socialPostCreateMock).not.toHaveBeenCalled();
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    },
  );
  it("clears delegated scheduler attribution when a human reschedules", async () => {
    const { scheduleSocialPost } = await loadService();
    await scheduleSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: draftPost.revision,
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt: new Date(NOW.getTime() + 120_000),
    });
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledByUserId: USER_ID,
          scheduledByCoworkerId: null,
        }),
      }),
    );
  });
  it("updates delegation when a coworker edits scheduled content", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      status: "SCHEDULED",
      socialConnectionId: SOCIAL_CONNECTION_ID,
    });
    const { updateSocialPost } = await loadService();
    await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      coworkerId: "cow_123",
      postId: POST_ID,
      revision: draftPost.revision,
      text: "Edited",
    });
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledByUserId: USER_ID,
          scheduledByCoworkerId: "cow_123",
        }),
      }),
    );
  });

  it("copies a published post into a new draft without the provider id", async () => {
    const published = {
      ...scheduledPost,
      status: "PUBLISHED",
      text: "Winner",
      firstComment: "#winner",
      media: [IMAGE_REF],
      publishedAt: NOW,
      publishedExternalId: "1907",
      publishedUrl: "https://x.com/sokosumi/status/1907",
    };
    socialPostFindFirstMock.mockResolvedValue(published);
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      id: "55555555-5555-4555-8555-555555555555",
      text: "Winner",
      firstComment: "#winner",
      media: [IMAGE_REF],
      socialConnectionId: SOCIAL_CONNECTION_ID,
      socialConnection: scheduledPost.socialConnection,
    });
    const { duplicateSocialPost } = await loadService();

    const post = await duplicateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          socialConnectionId: SOCIAL_CONNECTION_ID,
          provider: "x",
          text: "Winner",
          firstComment: "#winner",
          media: [IMAGE_REF],
          status: "DRAFT",
          creatorUserId: USER_ID,
          creatorCoworkerId: null,
        },
      }),
    );
    expect(post).toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      status: "DRAFT",
      text: "Winner",
      firstComment: "#winner",
      canDuplicate: false,
      publishedExternalId: null,
      scheduledAt: null,
    });
  });

  it.each(["FAILED", "MISSED"] as const)(
    "duplicates a %s post",
    async (status) => {
      socialPostFindFirstMock.mockResolvedValue({
        ...scheduledPost,
        status,
        lastError: "gone",
      });
      socialPostCreateMock.mockResolvedValue(draftPost);
      const { duplicateSocialPost } = await loadService();

      await duplicateSocialPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        postId: POST_ID,
      });

      expect(socialPostCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "DRAFT",
            text: scheduledPost.text,
            socialConnectionId: SOCIAL_CONNECTION_ID,
          }),
        }),
      );
    },
  );

  it.each(["DRAFT", "SCHEDULED", "PUBLISHING", "CANCELED"] as const)(
    "rejects duplicating a %s post",
    async (status) => {
      socialPostFindFirstMock.mockResolvedValue({ ...draftPost, status });
      const { duplicateSocialPost } = await loadService();

      await expect(
        duplicateSocialPost({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organizationId: null,
          userId: USER_ID,
          postId: POST_ID,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Only a published, failed, or missed post can be duplicated",
      });
      expect(socialPostCreateMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the provider when the account is gone or disconnected", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...scheduledPost,
      status: "PUBLISHED",
      provider: "linkedin",
      socialConnection: {
        ...scheduledPost.socialConnection,
        status: "disconnected",
      },
    });
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      provider: "linkedin",
    });
    const { duplicateSocialPost } = await loadService();

    await duplicateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "linkedin",
          socialConnectionId: null,
        }),
      }),
    );
  });

  it("records a coworker as the draft creator", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...scheduledPost,
      status: "PUBLISHED",
    });
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      creatorUserId: null,
      creatorCoworkerId: "cow_123",
      creatorUser: null,
      creatorCoworker: { id: "cow_123", name: "Scout" },
    });
    const { duplicateSocialPost } = await loadService();

    const post = await duplicateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      coworkerId: "cow_123",
      postId: POST_ID,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorUserId: null,
          creatorCoworkerId: "cow_123",
        }),
      }),
    );
    expect(post.creator).toEqual({
      kind: "coworker",
      id: "cow_123",
      name: "Scout",
    });
  });

  const accountPost = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    connectionId: SOCIAL_CONNECTION_ID,
    externalId: "1907",
    text: "Winner on the feed",
    connection: {
      id: SOCIAL_CONNECTION_ID,
      status: "active",
      provider: "x",
    },
  };

  it("recycles a matching published post through duplicate", async () => {
    const published = {
      ...scheduledPost,
      status: "PUBLISHED",
      text: "Winner on the feed",
      publishedExternalId: "1907",
    };
    socialAccountPostFindFirstMock.mockResolvedValue(accountPost);
    socialPostFindFirstMock
      .mockResolvedValueOnce({ id: POST_ID })
      .mockResolvedValueOnce(published);
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      id: "55555555-5555-4555-8555-555555555555",
      text: "Winner on the feed",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      socialConnection: scheduledPost.socialConnection,
    });
    const { recycleSocialAccountPost } = await loadService();

    const post = await recycleSocialAccountPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      accountPostId: accountPost.id,
    });

    expect(post).toMatchObject({
      status: "DRAFT",
      text: "Winner on the feed",
      publishedExternalId: null,
    });
  });

  it("recycles imported text when no Sokosumi post matches", async () => {
    socialAccountPostFindFirstMock.mockResolvedValue(accountPost);
    socialPostFindFirstMock.mockResolvedValue(null);
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      text: "Winner on the feed",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      socialConnection: scheduledPost.socialConnection,
    });
    const { recycleSocialAccountPost } = await loadService();

    await recycleSocialAccountPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      accountPostId: accountPost.id,
    });

    expect(socialPostCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: "Winner on the feed",
          socialConnectionId: SOCIAL_CONNECTION_ID,
          status: "DRAFT",
        }),
      }),
    );
  });

  it("schedules the recycled draft when a delay is chosen", async () => {
    socialAccountPostFindFirstMock.mockResolvedValue(accountPost);
    socialPostFindFirstMock.mockResolvedValue({
      ...draftPost,
      text: "Winner on the feed",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      socialConnection: scheduledPost.socialConnection,
    });
    socialPostFindFirstMock.mockResolvedValueOnce(null);
    socialPostCreateMock.mockResolvedValue({
      ...draftPost,
      text: "Winner on the feed",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      socialConnection: scheduledPost.socialConnection,
    });
    socialPostUpdateManyMock.mockResolvedValue({ count: 1 });
    const { recycleSocialAccountPost } = await loadService();

    await recycleSocialAccountPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      accountPostId: accountPost.id,
      delayDays: 7,
      timezone: "Europe/Zurich",
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SCHEDULED",
          timezone: "Europe/Zurich",
        }),
      }),
    );
  });

  it("rejects a missing Performance post", async () => {
    socialAccountPostFindFirstMock.mockResolvedValue(null);
    const { recycleSocialAccountPost } = await loadService();
    await expect(
      recycleSocialAccountPost({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organizationId: null,
        userId: USER_ID,
        accountPostId: accountPost.id,
      }),
    ).rejects.toThrow("Performance post not found");
  });

  it("clears retry state when a scheduled post is edited after a failed attempt", async () => {
    socialPostFindFirstMock.mockResolvedValue({
      ...scheduledPost,
      lastError: "X is unavailable",
      attemptCount: 2,
      nextAttemptAt: FUTURE,
    });
    const { updateSocialPost } = await loadService();

    await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
      revision: scheduledPost.revision,
      text: "Fixed copy",
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: "Fixed copy",
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
        }),
      }),
    );
    expect(socialPostUpdateManyMock.mock.calls[0]?.[0].data).not.toHaveProperty(
      "scheduledAt",
    );
  });

  it("moves a past-due scheduled post to now when it is edited", async () => {
    const pastDue = new Date(NOW.getTime() - 70 * 60_000);
    socialPostFindFirstMock.mockResolvedValue({
      ...scheduledPost,
      scheduledAt: pastDue,
      lastError: "X is unavailable",
      attemptCount: 2,
      nextAttemptAt: FUTURE,
    });
    const { updateSocialPost } = await loadService();

    await updateSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      organizationId: null,
      userId: USER_ID,
      postId: POST_ID,
      revision: scheduledPost.revision,
      text: "Fixed copy",
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: "Fixed copy",
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
          scheduledAt: NOW,
        }),
      }),
    );
  });

  it("keeps needs-approval when a time is set", async () => {
    const pending = { ...scheduledPost, status: "NEEDS_APPROVAL", revision: 2 };
    socialPostFindFirstMock
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, revision: 3 });
    const { scheduleSocialPost } = await loadService();

    const post = await scheduleSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      scheduledAt: FUTURE,
      timezone: "Europe/Zurich",
      revision: 2,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "NEEDS_APPROVAL" }),
      }),
    );
    expect(post).toMatchObject({
      status: "NEEDS_APPROVAL",
      canApprove: true,
      canPublishNow: false,
    });
  });

  it("approves a pending post with a future time into scheduled", async () => {
    const pending = { ...scheduledPost, status: "NEEDS_APPROVAL", revision: 2 };
    socialPostFindFirstMock
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        ...pending,
        status: "SCHEDULED",
        scheduledByUserId: USER_ID,
        scheduledByCoworkerId: null,
        revision: 3,
      });
    const { approveSocialPost } = await loadService();

    const post = await approveSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 2,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 2 },
      data: {
        status: "SCHEDULED",
        scheduledByUserId: USER_ID,
        scheduledByCoworkerId: null,
        revision: { increment: 1 },
      },
    });
    expect(post).toMatchObject({
      status: "SCHEDULED",
      canApprove: false,
      canPublishNow: true,
    });
  });

  it("approves a pending post without a future time into a draft", async () => {
    const pending = {
      ...draftPost,
      status: "NEEDS_APPROVAL",
      scheduledAt: null,
    };
    socialPostFindFirstMock
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...draftPost, revision: 1 });
    const { approveSocialPost } = await loadService();

    const post = await approveSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 0 },
      data: {
        status: "DRAFT",
        revision: { increment: 1 },
      },
    });
    expect(post).toMatchObject({ status: "DRAFT", canApprove: false });
  });

  it("rejects a pending post by canceling it", async () => {
    const pending = { ...draftPost, status: "NEEDS_APPROVAL" };
    socialPostFindFirstMock
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        ...pending,
        status: "CANCELED",
        canceledAt: NOW,
        revision: 1,
      });
    const { rejectSocialPost } = await loadService();

    const post = await rejectSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: { id: POST_ID, revision: 0 },
      data: {
        status: "CANCELED",
        canceledAt: NOW,
        revision: { increment: 1 },
      },
    });
    expect(post).toMatchObject({
      status: "CANCELED",
      canApprove: false,
      canReject: false,
    });
  });

  it.each(["approveSocialPost", "rejectSocialPost"] as const)(
    "refuses to %s a draft",
    async (operation) => {
      const service = await loadService();

      await expect(
        service[operation]({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 0,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    },
  );
});
