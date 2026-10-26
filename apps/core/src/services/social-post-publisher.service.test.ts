import type { SocialPostThreadPart } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposioApiError } from "@/clients/composio.client";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";
import { forbidden } from "@/helpers/error";
import { summarizeSocialPostThread } from "@/helpers/social-post-thread";
import prisma from "@/lib/db/prisma";

const {
  publishingAccessMock,
  attemptFindFirstMock,
  attemptAggregateMock,
  attemptCreateMock,
  attemptUpdateMock,
  getSocialPostMock,
  publishFirstCommentMock,
  publishXPostMock,
  socialPostFindFirstMock,
  socialPostFindManyMock,
  socialPostUpdateManyMock,
  threadPartUpdateMock,
  projectFindFirstMock,
  queryRawMock,
  transactionMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  publishingAccessMock: vi.fn(),
  attemptFindFirstMock: vi.fn(),
  attemptAggregateMock: vi.fn(),
  attemptCreateMock: vi.fn(),
  attemptUpdateMock: vi.fn(),
  getSocialPostMock: vi.fn(),
  publishFirstCommentMock: vi.fn(),
  publishXPostMock: vi.fn(),
  socialPostFindFirstMock: vi.fn(),
  socialPostFindManyMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
  threadPartUpdateMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@/helpers/social-post-access", () => ({
  requireSocialPostPublishingAccess: publishingAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    $queryRaw: queryRawMock,
    $transaction: transactionMock,
    socialPost: {
      findFirst: socialPostFindFirstMock,
      findMany: socialPostFindManyMock,
      updateMany: socialPostUpdateManyMock,
    },
    socialPostPublishAttempt: {
      findFirst: attemptFindFirstMock,
      aggregate: attemptAggregateMock,
      create: attemptCreateMock,
      update: attemptUpdateMock,
    },
    socialPostThreadPart: { update: threadPartUpdateMock },
  },
}));

vi.mock("@/clients/social-post-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/social-post-providers")>()),
  publishSocialPostToProvider: publishXPostMock,
}));

vi.mock("@/clients/social-post-providers/first-comment", () => ({
  publishSocialPostFirstComment: publishFirstCommentMock,
}));

vi.mock("@/services/social-posts.service", () => ({
  getSocialPost: getSocialPostMock,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const SOCIAL_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "user_123";
const NOW = new Date("2026-09-15T10:00:00.000Z");
const SCHEDULED_AT = new Date("2026-09-15T09:59:00.000Z");

const activeConnection = {
  id: SOCIAL_CONNECTION_ID,
  status: "active",
  composioConnectedAccountId: "ca_123",
  externalAccountId: "x_account",
  externalHandle: "sokosumi",
};

const IMAGE_REF = {
  pathname: "drive/users/user_123/launch.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_123/launch.png",
  name: "launch.png",
  size: 3,
  mimeType: "image/png",
  kind: "image",
};

const CLIP_REF = {
  pathname: "drive/users/user_123/clip.mp4",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_123/clip.mp4",
  name: "clip.mp4",
  size: 3,
  mimeType: "video/mp4",
  kind: "video",
};

function mediaResponse(
  body: Uint8Array<ArrayBuffer>,
  contentType: string | null,
  status = 200,
): Response {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Response(status === 204 ? null : body, { status, headers });
}

const duePost = {
  id: POST_ID,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  provider: "x",
  text: "Hello world",
  firstComment: null,
  media: [],
  threadParts: [],
  publishedExternalId: null,
  quotedPostId: null,
  needsAttentionReason: null,
  publishingThreadPartPosition: null,
  status: "SCHEDULED",
  scheduledAt: SCHEDULED_AT,
  attemptCount: 0,
  nextAttemptAt: null,
  leaseToken: null,
  leaseExpiresAt: null,
  revision: 1,
  socialConnection: activeConnection,
};

const syncContext = {
  abortSignal: new AbortController().signal,
  deadlineMs: NOW.getTime() + 60_000,
  shouldContinue: () => true,
};

async function loadService() {
  return import("./social-post-publisher.service");
}

function claimCall() {
  return socialPostUpdateManyMock.mock.calls[0]?.[0];
}

function settleCall() {
  return socialPostUpdateManyMock.mock.calls[1]?.[0];
}

describe("social post publisher service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });
    queryRawMock.mockResolvedValue([{ id: PROJECT_ID }]);
    transactionMock.mockImplementation(async (callback) =>
      callback({ ...prisma }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    socialPostFindFirstMock
      .mockResolvedValueOnce(duePost)
      .mockResolvedValue(null);
    socialPostUpdateManyMock.mockResolvedValue({ count: 1 });
    socialPostFindManyMock.mockResolvedValue([]);
    attemptFindFirstMock.mockResolvedValue(null);
    attemptAggregateMock.mockResolvedValue({ _max: { attempt: null } });
    attemptCreateMock.mockResolvedValue({ id: ATTEMPT_ID });
    attemptUpdateMock.mockResolvedValue({ id: ATTEMPT_ID });
    publishXPostMock.mockResolvedValue({
      externalId: "1907",
      publishedUrl: "https://x.com/sokosumi/status/1907",
      toolSlug: "TWITTER_CREATION_OF_A_POST",
    });
    publishFirstCommentMock.mockResolvedValue(undefined);
    getSocialPostMock.mockResolvedValue({ id: POST_ID, status: "PUBLISHED" });
    ssrfSafeFetchMock.mockImplementation(async () =>
      mediaResponse(new Uint8Array([1, 2, 3]), "image/png"),
    );
  });

  describe("X quote publishing", () => {
    const TARGET_ID = "77777777-7777-4777-8777-777777777777";
    const quotePost = { ...duePost, quotedPostId: TARGET_ID };
    const target = { status: "PUBLISHED", publishedExternalId: "1906" };

    function prepare(
      dependency: { status: string; publishedExternalId: string | null } | null,
      post = quotePost,
    ) {
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce(post)
        .mockResolvedValueOnce(dependency)
        .mockResolvedValue(null);
    }

    it("publishes with the quoted post's stored X id", async () => {
      prepare(target);
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        published: 1,
      });
      expect(publishXPostMock).toHaveBeenCalledWith(
        expect.objectContaining({ quoteExternalId: "1906" }),
      );
    });

    it("also publishes now once the target has a confirmed X id", async () => {
      socialPostFindFirstMock
        .mockReset()
        .mockImplementation(async ({ where }) =>
          where.id === TARGET_ID
            ? { ...target, id: TARGET_ID, provider: "x", quotedPostId: null }
            : quotePost,
        );
      const { publishSocialPostNow } = await loadService();
      await publishSocialPostNow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        postId: POST_ID,
        userId: USER_ID,
        revision: 1,
      });
      expect(publishXPostMock).toHaveBeenCalledWith(
        expect.objectContaining({ quoteExternalId: "1906" }),
      );
    });

    it("flags dependent quotes immediately when their target fails before its first part", async () => {
      socialPostFindManyMock.mockResolvedValue([
        { id: TARGET_ID, status: "SCHEDULED" },
      ]);
      publishXPostMock.mockRejectedValueOnce(
        new ComposioToolError({
          message: "X refused",
          providerStatus: 400,
          providerMessage: "Rejected",
        }),
      );
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
      });
      expect(socialPostUpdateManyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            quotedPostId: POST_ID,
            publishedExternalId: null,
          }),
          data: expect.objectContaining({
            status: "FAILED",
            needsAttentionReason: "The post it quotes failed to publish",
          }),
        }),
      );
    });

    it("defers without consuming attempts, then publishes after the target becomes live", async () => {
      prepare({ status: "SCHEDULED", publishedExternalId: null });
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        retried: 1,
        failed: 0,
      });
      expect(settleCall().data).toMatchObject({
        status: "SCHEDULED",
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
      });
      expect(settleCall().data).not.toHaveProperty("attemptCount");
      expect(attemptCreateMock).not.toHaveBeenCalled();
      expect(publishXPostMock).not.toHaveBeenCalled();
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      prepare(target);
      expect(
        await publishDueSocialPosts({
          ...syncContext,
          deadlineMs: Date.now() + 60_000,
        }),
      ).toMatchObject({ published: 1 });
      expect(publishXPostMock).toHaveBeenCalledTimes(1);
    });

    it.each(["FAILED", "MISSED", "CANCELED", "DRAFT"])(
      "needs attention when its target is %s without a head",
      async (status) => {
        prepare({ status, publishedExternalId: null });
        const { publishDueSocialPosts } = await loadService();
        expect(await publishDueSocialPosts(syncContext)).toMatchObject({
          failed: 1,
          published: 0,
        });
        expect(settleCall().data).toMatchObject({
          status: "FAILED",
          needsAttentionReason: ["CANCELED", "DRAFT"].includes(status)
            ? "The quoted post was cancelled"
            : "The post it quotes failed to publish",
        });
        expect(publishXPostMock).not.toHaveBeenCalled();
      },
    );

    it("quotes the head of a partially failed thread", async () => {
      prepare({ status: "FAILED", publishedExternalId: "1906" });
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        published: 1,
      });
      expect(publishXPostMock).toHaveBeenCalledWith(
        expect.objectContaining({ quoteExternalId: "1906" }),
      );
    });

    it("stops waiting after 30 minutes past due", async () => {
      prepare({ status: "SCHEDULED", publishedExternalId: null });
      vi.setSystemTime(new Date(SCHEDULED_AT.getTime() + 30 * 60_000));
      const { publishDueSocialPosts } = await loadService();
      expect(
        await publishDueSocialPosts({
          ...syncContext,
          deadlineMs: Date.now() + 60_000,
        }),
      ).toMatchObject({ failed: 1, retried: 0 });
      expect(settleCall().data.needsAttentionReason).toContain(
        "within 30 minutes",
      );
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("blocks a deleted quote even after its FK was cleared", async () => {
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce({
          ...duePost,
          needsAttentionReason: "The quoted post was cancelled",
        })
        .mockResolvedValue(null);
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("rejects post now before claiming when the quoted post is not live", async () => {
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce(quotePost)
        .mockResolvedValueOnce({
          id: TARGET_ID,
          provider: "x",
          status: "SCHEDULED",
          quotedPostId: null,
          publishedExternalId: null,
        });
      const { publishSocialPostNow } = await loadService();
      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          postId: POST_ID,
          userId: USER_ID,
          revision: 1,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("quoted post is not live yet"),
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("uses normal provider failure handling when X refuses a deleted external post", async () => {
      prepare(target);
      publishXPostMock.mockRejectedValueOnce(
        new ComposioToolError({
          message: "X refused",
          providerStatus: 400,
          providerMessage: "Quoted post does not exist",
        }),
      );
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
      });
      expect(settleCall().data.lastError).toContain(
        "Quoted post does not exist",
      );
    });
  });

  describe("X thread publishing", () => {
    interface ThreadState
      extends Omit<
        typeof duePost,
        | "threadParts"
        | "publishedExternalId"
        | "publishingThreadPartPosition"
        | "leaseToken"
        | "leaseExpiresAt"
        | "nextAttemptAt"
        | "firstComment"
      > {
      threadParts: SocialPostThreadPart[];
      publishedExternalId: string | null;
      publishedAt: Date | null;
      publishedUrl: string | null;
      publishingThreadPartPosition: number | null;
      leaseToken: string | null;
      leaseExpiresAt: Date | null;
      nextAttemptAt: Date | null;
      lastError: string | null;
      firstComment: string | null;
    }
    let state: ThreadState;

    function readPost({
      where,
    }: {
      where: { OR?: unknown; leaseToken?: string };
    }) {
      if (where.OR) {
        if (
          state.status === "SCHEDULED" &&
          state.nextAttemptAt &&
          state.nextAttemptAt > new Date()
        )
          return null;
        if (
          state.status === "PUBLISHING" &&
          state.leaseExpiresAt &&
          state.leaseExpiresAt >= new Date()
        )
          return null;
        if (state.status !== "SCHEDULED" && state.status !== "PUBLISHING")
          return null;
      }
      if (where.leaseToken && where.leaseToken !== state.leaseToken)
        return null;
      return structuredClone(state);
    }

    function result(externalId: string) {
      return {
        externalId,
        publishedUrl: `https://x.com/sokosumi/status/${externalId}`,
        toolSlug: "TWITTER_CREATION_OF_A_POST",
      };
    }

    beforeEach(() => {
      state = {
        ...duePost,
        publishedAt: null,
        publishedUrl: null,
        lastError: null,
        threadParts: [2, 3].map((position) => ({
          id: `part-${position}`,
          postId: POST_ID,
          position,
          text: position === 2 ? "Second" : "Third",
          media: position === 2 ? [IMAGE_REF] : [],
          externalPostId: null,
          publishedAt: null,
          error: null,
        })),
      };
      socialPostFindFirstMock.mockReset().mockImplementation(readPost);
      socialPostUpdateManyMock.mockImplementation(async ({ where, data }) => {
        if (where.leaseToken && where.leaseToken !== state.leaseToken)
          return { count: 0 };
        if (where.revision !== undefined && where.revision !== state.revision)
          return { count: 0 };
        const revision = state.revision;
        Object.assign(state, data);
        if (data.revision?.increment)
          state.revision = revision + data.revision.increment;
        return { count: 1 };
      });
      threadPartUpdateMock.mockImplementation(async ({ where, data }) => {
        const part = state.threadParts.find((part) => part.id === where.id);
        Object.assign(part ?? {}, data);
        return part;
      });
      transactionMock.mockImplementation(async (callback) => {
        const snapshot = structuredClone(state);
        try {
          return await callback({ ...prisma });
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      });
      publishXPostMock.mockImplementation(async ({ text }) =>
        result(
          text === "Hello world" ? "1907" : text === "Second" ? "1908" : "1909",
        ),
      );
      getSocialPostMock.mockImplementation(async () => ({
        ...state,
        ...summarizeSocialPostThread(state),
      }));
    });

    it("publishes three parts in order with each part's own media and comments on the last", async () => {
      state.firstComment = "#launch";
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        published: 1,
      });
      expect(
        publishXPostMock.mock.calls.map(([input]) => ({
          text: input.text,
          replyTo: input.replyToExternalId,
          media: input.media,
        })),
      ).toEqual([
        { text: "Hello world", replyTo: undefined, media: [] },
        { text: "Second", replyTo: "1907", media: [IMAGE_REF] },
        { text: "Third", replyTo: "1908", media: [] },
      ]);
      expect(state.publishedExternalId).toBe("1907");
      expect(state.threadParts.map((part) => part.externalPostId)).toEqual([
        "1908",
        "1909",
      ]);
      expect(
        state.threadParts.every((part) => part.publishedAt && !part.error),
      ).toBe(true);
      expect(publishFirstCommentMock).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: "1909" }),
      );
    });

    it("quotes only on the first part and keeps subsequent parts as replies", async () => {
      socialPostFindFirstMock.mockImplementation((input) => {
        if (input.where.id === "quote-target")
          return { status: "PUBLISHED", publishedExternalId: "1906" };
        return { ...readPost(input), quotedPostId: "quote-target" };
      });
      const { publishDueSocialPosts } = await loadService();
      expect(
        await publishDueSocialPosts({
          ...syncContext,
          shouldContinue: () => publishXPostMock.mock.calls.length === 0,
        }),
      ).toMatchObject({ published: 1 });
      expect(
        publishXPostMock.mock.calls.map(([input]) => [
          input.quoteExternalId,
          input.replyToExternalId,
        ]),
      ).toEqual([
        ["1906", undefined],
        [undefined, "1907"],
        [undefined, "1908"],
      ]);
    });

    it("persists the head on failure at part 2 and post-now resumes only parts 2..3", async () => {
      socialPostFindManyMock.mockResolvedValue([
        { id: "dependent-quote", status: "SCHEDULED" },
      ]);
      publishXPostMock
        .mockResolvedValueOnce(result("1907"))
        .mockRejectedValueOnce(
          new ComposioToolError({
            message: "X refused the post",
            providerStatus: 400,
            providerMessage: "Rejected",
          }),
        );
      const { publishDueSocialPosts, publishSocialPostNow } =
        await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
      });
      expect(state).toMatchObject({
        status: "FAILED",
        publishedExternalId: "1907",
        publishingThreadPartPosition: null,
      });
      expect(summarizeSocialPostThread(state)).toMatchObject({
        partiallyPublished: true,
        publishedThreadPartCount: 1,
        failedThreadPartPosition: 2,
      });
      expect(state.threadParts[0].error).toContain("Thread part 2 failed");
      expect(state.threadParts[1].externalPostId).toBeNull();
      expect(publishFirstCommentMock).not.toHaveBeenCalled();
      expect(socialPostFindManyMock).not.toHaveBeenCalled();

      vi.setSystemTime(new Date(NOW.getTime() + 86_400_000));
      const retried = await publishSocialPostNow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        revision: state.revision,
      });
      expect(retried).toMatchObject({
        status: "PUBLISHED",
        partiallyPublished: false,
        failedThreadPartPosition: null,
        publishedThreadPartCount: 3,
        publishedAt: NOW,
      });
      expect(
        publishXPostMock.mock.calls
          .slice(2)
          .map(([input]) => [input.text, input.replyToExternalId]),
      ).toEqual([
        ["Second", "1907"],
        ["Third", "1908"],
      ]);
      expect(
        publishXPostMock.mock.calls.filter(
          ([input]) => input.text === "Hello world",
        ),
      ).toHaveLength(1);
    });

    it("resumes an automatic transient retry from the stored head", async () => {
      publishXPostMock
        .mockResolvedValueOnce(result("1907"))
        .mockRejectedValueOnce(
          new ComposioApiError(429, undefined, "Rate limited"),
        );
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        retried: 1,
      });
      expect(state.status).toBe("SCHEDULED");
      expect(summarizeSocialPostThread(state).partiallyPublished).toBe(true);
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      expect(
        await publishDueSocialPosts({
          ...syncContext,
          deadlineMs: Date.now() + 60_000,
        }),
      ).toMatchObject({ published: 1 });
      expect(
        publishXPostMock.mock.calls
          .slice(2)
          .map(([input]) => input.replyToExternalId),
      ).toEqual(["1907", "1908"]);
    });

    it("recovers a worker crash between parts without duplicating the stored head", async () => {
      let reads = 0;
      socialPostFindFirstMock.mockImplementation((input) => {
        if (input.where.leaseToken && ++reads === 2)
          throw new Error("Worker stopped between parts");
        return readPost(input);
      });
      attemptUpdateMock.mockRejectedValueOnce(
        new Error("Worker stopped before settlement"),
      );
      const { publishDueSocialPosts, LEASE_MS } = await loadService();
      await expect(publishDueSocialPosts(syncContext)).rejects.toThrow(
        "Worker stopped before settlement",
      );
      expect(state).toMatchObject({
        status: "PUBLISHING",
        publishedExternalId: "1907",
        publishingThreadPartPosition: null,
      });
      socialPostFindFirstMock.mockImplementation(readPost);
      vi.setSystemTime(new Date(NOW.getTime() + LEASE_MS + 1));
      expect(
        await publishDueSocialPosts({
          ...syncContext,
          deadlineMs: Date.now() + 60_000,
        }),
      ).toMatchObject({ published: 1 });
      expect(publishXPostMock.mock.calls.map(([input]) => input.text)).toEqual([
        "Hello world",
        "Second",
        "Third",
      ]);
    });

    it("reconciles all saved ids after a crash before final settlement without calling X", async () => {
      state.status = "PUBLISHING";
      state.leaseExpiresAt = new Date(NOW.getTime() - 1);
      state.publishedExternalId = "1907";
      state.publishedUrl = result("1907").publishedUrl;
      state.threadParts.forEach((part) => {
        part.externalPostId = String(1906 + part.position);
        part.publishedAt = NOW;
      });
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        published: 1,
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("blocks an unconfirmed create after a crash instead of duplicating it", async () => {
      state.status = "PUBLISHING";
      state.leaseExpiresAt = new Date(NOW.getTime() - 1);
      state.publishedExternalId = "1907";
      state.publishingThreadPartPosition = 2;
      const { publishDueSocialPosts, publishSocialPostNow } =
        await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
        retried: 0,
      });
      expect(state.threadParts[0].error).toContain("Check X before retrying");
      expect(publishXPostMock).not.toHaveBeenCalled();
      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: state.revision,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("recovers a finalized permanent failure without dispatching rejected parts again", async () => {
      state.status = "PUBLISHING";
      state.leaseExpiresAt = new Date(NOW.getTime() - 1);
      state.publishedExternalId = "1907";
      state.threadParts[0].error = "Thread part 2 failed: Rejected";
      attemptFindFirstMock.mockResolvedValue({
        outcome: "failed_permanent",
        finishedAt: NOW,
        externalId: null,
        providerOutcome: "Thread part 2 failed: Rejected",
      });
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(state.status).toBe("FAILED");
      expect(summarizeSocialPostThread(state).failedThreadPartPosition).toBe(2);
    });

    it("keeps the in-flight marker if storage fails after X creates a part", async () => {
      state.publishedExternalId = "1907";
      threadPartUpdateMock.mockRejectedValueOnce(
        new Error("Storage unavailable after X returned an id"),
      );
      const { publishDueSocialPosts, publishSocialPostNow } =
        await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
        retried: 0,
      });
      expect(state).toMatchObject({
        publishedExternalId: "1907",
        publishingThreadPartPosition: 2,
      });
      expect(state.threadParts[0].externalPostId).toBeNull();
      expect(summarizeSocialPostThread(state)).toMatchObject({
        failedThreadPartPosition: 2,
        partiallyPublished: true,
      });
      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: state.revision,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(publishXPostMock).toHaveBeenCalledTimes(1);
    });

    it("retains the marker when X returns an ambiguous outcome", async () => {
      publishXPostMock.mockRejectedValueOnce(
        new ComposioPublishOutcomeUnknownError("X"),
      );
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
        retried: 0,
      });
      expect(state).toMatchObject({
        status: "FAILED",
        publishedExternalId: null,
        publishingThreadPartPosition: 1,
      });
    });

    it("stops before the next call when its lease is lost", async () => {
      let reads = 0;
      socialPostFindFirstMock.mockImplementation((input) => {
        if (input.where.leaseToken && ++reads === 2)
          state.leaseToken = "new-worker";
        return readPost(input);
      });
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        skipped: 1,
      });
      expect(publishXPostMock).toHaveBeenCalledTimes(1);
      expect(state.publishedExternalId).toBe("1907");
    });
  });

  it.each(["closingAt", "closedAt"])(
    "does not dispatch a claimed post when its Project has %s",
    async (field) => {
      projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID, [field]: NOW });
      const { publishDueSocialPosts } = await loadService();

      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        claimed: 1,
        failed: 1,
        published: 0,
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(settleCall().data).toMatchObject({
        status: "FAILED",
        lastError: "Cannot publish Social posts in a closing or closed Project",
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      });
    },
  );

  it("rechecks the Project immediately before dispatch", async () => {
    projectFindFirstMock
      .mockResolvedValueOnce({ id: PROJECT_ID })
      .mockResolvedValue({ id: PROJECT_ID, closingAt: NOW });
    const { publishDueSocialPosts } = await loadService();

    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      failed: 1,
      published: 0,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: { finishedAt: NOW, outcome: "project_closed" },
    });
  });

  it("does not requeue a transient failure after its Project closes", async () => {
    publishXPostMock.mockImplementation(async () => {
      projectFindFirstMock.mockResolvedValue({
        id: PROJECT_ID,
        closingAt: NOW,
      });
      throw new ComposioApiError(429, undefined, "publish X post failed (429)");
    });
    const { publishDueSocialPosts } = await loadService();

    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      failed: 1,
      retried: 0,
    });
    expect(settleCall().data).toMatchObject({
      status: "FAILED",
      nextAttemptAt: null,
      leaseToken: null,
    });
    expect(socialPostUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      }),
    );
  });

  it("does not recover a transient failure into a schedule after close", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({ ...duePost, status: "PUBLISHING" })
      .mockResolvedValue(null);
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID, closedAt: NOW });
    attemptFindFirstMock.mockResolvedValue({
      outcome: "failed_transient",
      finishedAt: NOW,
    });
    const { publishDueSocialPosts } = await loadService();

    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      failed: 1,
      retried: 0,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data).toMatchObject({
      status: "FAILED",
      nextAttemptAt: null,
      leaseToken: null,
    });
  });

  it("reconciles a recorded success after close without publishing again", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({ ...duePost, status: "PUBLISHING" })
      .mockResolvedValue(null);
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID, closedAt: NOW });
    attemptFindFirstMock.mockResolvedValue({
      outcome: "succeeded",
      externalId: "1907",
      finishedAt: NOW,
    });
    const { publishDueSocialPosts } = await loadService();

    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      published: 1,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data.status).toBe("PUBLISHED");
  });

  it("aborts provider work at the execution deadline and settles before the lease expires", async () => {
    vi.useRealTimers();
    const { publishDueSocialPosts } = await loadService();
    const now = Date.now();
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({ ...duePost, scheduledAt: new Date(now - 1_000) })
      .mockResolvedValue(null);
    publishXPostMock.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    await publishDueSocialPosts({ ...syncContext, deadlineMs: now + 20_100 });
    expect(publishXPostMock).toHaveBeenCalledOnce();
    expect(settleCall().data.leaseToken).toBeNull();
    expect(settleCall().data.status).not.toBe("PUBLISHING");
  });

  it("does not claim another post when only settlement time remains", async () => {
    const { publishDueSocialPosts } = await loadService();
    const result = await publishDueSocialPosts({
      ...syncContext,
      deadlineMs: Date.now() + 19_000,
    });
    expect(result.claimed).toBe(0);
    expect(socialPostFindFirstMock).not.toHaveBeenCalled();
  });

  it("cancels provider work without publishing and durably settles the attempt", async () => {
    const controller = new AbortController();
    publishXPostMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const { publishDueSocialPosts } = await loadService();
    await publishDueSocialPosts({
      ...syncContext,
      abortSignal: controller.signal,
    });
    expect(settleCall().data.leaseToken).toBeNull();
    expect(settleCall().data.status).not.toBe("PUBLISHING");
  });

  it("claims a due post, publishes it, and records the attempt", async () => {
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      failed: 0,
      missed: 0,
      skipped: 0,
    });
    expect(socialPostFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          OR: [
            {
              status: "SCHEDULED",
              project: { closingAt: null, closedAt: null },
              AND: {
                OR: [
                  { scheduledByCoworkerId: { not: null } },
                  {
                    scheduledByCoworkerId: null,
                    scheduledByUser: {
                      members: { some: { organization: { slug: "utxo" } } },
                    },
                  },
                ],
              },
              scheduledAt: { lte: NOW },
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: NOW } }],
            },
            { status: "PUBLISHING", leaseExpiresAt: { lt: NOW } },
          ],
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      }),
    );
    expect(claimCall()).toEqual({
      where: {
        id: POST_ID,
        status: "SCHEDULED",
        revision: 1,
        project: { closingAt: null, closedAt: null },
      },
      data: {
        status: "PUBLISHING",
        leaseToken: expect.any(String),
        leaseExpiresAt: new Date(NOW.getTime() + 5 * 60_000),
        lastAttemptAt: NOW,
        revision: { increment: 1 },
      },
    });
    const leaseToken = claimCall().data.leaseToken;
    expect(attemptCreateMock).toHaveBeenCalledWith({
      data: {
        socialPostId: POST_ID,
        attempt: 1,
        trigger: "scheduler",
        actorUserId: null,
        toolSlug: "TWITTER_CREATION_OF_A_POST",
      },
      select: { id: true },
    });
    expect(publishXPostMock).toHaveBeenCalledWith({
      provider: "x",
      connectedAccountId: "ca_123",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      externalAccountId: "x_account",
      externalHandle: "sokosumi",
      text: "Hello world",
      media: [],
      signal: expect.any(AbortSignal),
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: {
        finishedAt: NOW,
        outcome: "succeeded",
        errorKind: null,
        toolSlug: "TWITTER_CREATION_OF_A_POST",
        providerOutcome: "published",
        externalId: "1907",
      },
    });
    expect(settleCall()).toEqual({
      where: { id: POST_ID, leaseToken },
      data: {
        status: "PUBLISHED",
        publishedAt: NOW,
        publishedExternalId: "1907",
        publishedUrl: "https://x.com/sokosumi/status/1907",
        lastError: null,
        needsAttentionReason: null,
        attemptCount: 1,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        revision: { increment: 1 },
      },
    });
    expect(publishFirstCommentMock).not.toHaveBeenCalled();
  });

  it("posts the first comment after the post is live", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, firstComment: " #launch " })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    expect(publishFirstCommentMock).toHaveBeenCalledWith({
      provider: "x",
      connectedAccountId: "ca_123",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      externalAccountId: "x_account",
      externalId: "1907",
      text: "#launch",
      signal: expect.any(AbortSignal),
    });
    expect(settleCall().data.status).toBe("PUBLISHED");
  });

  it("keeps the post published when the first comment fails", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, firstComment: "#launch" })
      .mockResolvedValue(null);
    publishFirstCommentMock.mockRejectedValue(new Error("refused"));
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ published: 1, failed: 0 });
    expect(settleCall().data.status).toBe("PUBLISHED");
  });

  it("stores the published URL the adapter returned", async () => {
    publishXPostMock.mockResolvedValue({
      externalId: "1907",
      publishedUrl: "https://x.com/i/web/status/1907",
      toolSlug: "TWITTER_CREATION_OF_A_POST",
    });
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    expect(settleCall().data.publishedUrl).toBe(
      "https://x.com/i/web/status/1907",
    );
  });

  it("fails permanently on an unknown stored provider without dispatching", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, provider: "threads" })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ failed: 1 });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data).toMatchObject({
      status: "FAILED",
      lastError: "Unsupported social provider: threads",
    });
  });

  it("records the provider's attempt slug and the adapter's actual tool", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, provider: "linkedin" })
      .mockResolvedValue(null);
    publishXPostMock.mockResolvedValue({
      externalId: "urn:li:share:1",
      publishedUrl: "https://www.linkedin.com/feed/update/urn:li:share:1",
      toolSlug: "LINKEDIN_CREATE_VIDEO_POST",
    });
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    expect(attemptCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
        }),
      }),
    );
    expect(attemptUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolSlug: "LINKEDIN_CREATE_VIDEO_POST",
        }),
      }),
    );
  });

  it("numbers a new attempt after the highest recorded one", async () => {
    attemptAggregateMock.mockResolvedValue({ _max: { attempt: 4 } });
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    expect(attemptCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 5 }),
      }),
    );
  });

  it("recovers a recorded success after beta membership is lost without republishing", async () => {
    attemptFindFirstMock.mockResolvedValue({
      outcome: "succeeded",
      externalId: "1907",
      finishedAt: NOW,
    });
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...duePost,
        status: "PUBLISHING",
        leaseToken: "stale-lease",
        leaseExpiresAt: new Date(NOW.getTime() - 1_000),
        revision: 2,
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ claimed: 1, published: 1 });
    expect(socialPostFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          OR: [
            {
              status: "SCHEDULED",
              project: { closingAt: null, closedAt: null },
              AND: {
                OR: [
                  { scheduledByCoworkerId: { not: null } },
                  {
                    scheduledByCoworkerId: null,
                    scheduledByUser: {
                      members: { some: { organization: { slug: "utxo" } } },
                    },
                  },
                ],
              },
              scheduledAt: { lte: NOW },
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: NOW } }],
            },
            { status: "PUBLISHING", leaseExpiresAt: { lt: NOW } },
          ],
        },
      }),
    );
    expect(claimCall().where).toEqual({
      id: POST_ID,
      status: "PUBLISHING",
      revision: 2,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data).toMatchObject({
      status: "PUBLISHED",
      publishedExternalId: "1907",
    });
    expect(claimCall().data.leaseToken).not.toBe("stale-lease");
    expect(settleCall().where).toEqual({
      id: POST_ID,
      leaseToken: claimCall().data.leaseToken,
    });
  });

  it.each([null, { outcome: null, externalId: null, finishedAt: null }])(
    "requires verification for an expired lease with an uncertain result %j",
    async (attempt) => {
      attemptFindFirstMock.mockResolvedValue(attempt);
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce({ ...duePost, status: "PUBLISHING" })
        .mockResolvedValue(null);
      const { publishDueSocialPosts } = await loadService();
      expect(await publishDueSocialPosts(syncContext)).toMatchObject({
        failed: 1,
        published: 0,
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(settleCall().data.lastError).toContain("Check X before retrying");
    },
  );

  it.each([
    {
      outcome: "failed_transient",
      providerOutcome: "X rate limit",
      post: {
        scheduledAt: new Date(NOW.getTime() - 10 * 60_000),
      },
      expectedResult: { retried: 1, failed: 0, missed: 0 },
      expectedData: {
        status: "SCHEDULED",
        nextAttemptAt: new Date(NOW.getTime() - 4 * 60_000),
        attemptCount: 1,
        lastError: "X rate limit",
      },
    },
    {
      outcome: "failed_permanent",
      providerOutcome: "X rejected the post",
      post: {},
      expectedResult: { retried: 0, failed: 1, missed: 0 },
      expectedData: {
        status: "FAILED",
        attemptCount: 1,
        lastError: "X rejected the post",
      },
    },
    {
      outcome: "missed",
      providerOutcome: null,
      post: {
        scheduledAt: new Date(NOW.getTime() - 70 * 60_000),
      },
      expectedResult: { retried: 0, failed: 0, missed: 1 },
      expectedData: {
        status: "MISSED",
        lastError: "Missed: found 65 minutes after the planned time",
      },
    },
    {
      outcome: "project_closed",
      providerOutcome: null,
      post: {},
      expectedResult: { retried: 0, failed: 1, missed: 0 },
      expectedData: {
        status: "FAILED",
        lastError: "Cannot publish Social posts in a closing or closed Project",
      },
    },
    {
      outcome: "connection_inactive",
      providerOutcome: null,
      post: {},
      expectedResult: { retried: 0, failed: 1, missed: 0 },
      expectedData: {
        status: "FAILED",
        lastError: "Social connection needs reconnecting",
      },
    },
    {
      outcome: "authorization_revoked",
      providerOutcome: null,
      post: {},
      expectedResult: { retried: 0, failed: 1, missed: 0 },
      expectedData: {
        status: "FAILED",
        lastError:
          "Coworker scheduling access was revoked. A workspace member must reschedule this post.",
      },
    },
  ])(
    "recovers a finalized $outcome attempt after a crash before settling",
    async ({
      outcome,
      providerOutcome,
      post,
      expectedResult,
      expectedData,
    }) => {
      const finishedAt = new Date(NOW.getTime() - 5 * 60_000);
      attemptFindFirstMock.mockResolvedValue({
        outcome,
        externalId: null,
        finishedAt,
        providerOutcome,
      });
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce({
          ...duePost,
          ...post,
          status: "PUBLISHING",
          leaseToken: "stale-lease",
          leaseExpiresAt: new Date(NOW.getTime() - 1_000),
          revision: 2,
        })
        .mockResolvedValue(null);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject(expectedResult);
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(settleCall().data).toMatchObject(expectedData);
      expect(settleCall().data.lastError).not.toContain(
        "could not be confirmed",
      );
    },
  );

  it("does not retry an ambiguous create-post timeout", async () => {
    publishXPostMock.mockRejectedValue(
      new ComposioPublishOutcomeUnknownError("X"),
    );
    const { publishDueSocialPosts } = await loadService();
    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      failed: 1,
      retried: 0,
    });
    expect(settleCall().data.lastError).toContain("Check X before retrying");
  });

  it("does not publish a retry delayed beyond fifteen minutes by a cron outage", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({
        ...duePost,
        attemptCount: 1,
        scheduledAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
        nextAttemptAt: new Date(NOW.getTime() - 119 * 60_000),
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();
    expect(await publishDueSocialPosts(syncContext)).toMatchObject({
      failed: 1,
      published: 0,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data.lastError).toContain("retry window expired");
  });

  it("marks a post missed when first seen over an hour late, without calling X", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...duePost,
        scheduledAt: new Date(NOW.getTime() - 61 * 60_000),
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ claimed: 1, missed: 1, published: 0 });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(attemptCreateMock).toHaveBeenCalledWith({
      data: {
        socialPostId: POST_ID,
        attempt: 1,
        trigger: "scheduler",
        actorUserId: null,
        toolSlug: null,
        finishedAt: NOW,
        outcome: "missed",
      },
      select: { id: true },
    });
    expect(settleCall()).toEqual({
      where: { id: POST_ID, leaseToken: claimCall().data.leaseToken },
      data: {
        status: "MISSED",
        lastError: "Missed: found 61 minutes after the planned time",
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        revision: { increment: 1 },
      },
    });
  });

  it("expires a retry instead of publishing more than an hour late", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...duePost,
        scheduledAt: new Date(NOW.getTime() - 61 * 60_000),
        attemptCount: 1,
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ failed: 1, published: 0, missed: 0 });
    expect(publishXPostMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["not active", { ...activeConnection, status: "reauthorization_required" }],
  ])(
    "fails a post whose connection is %s without calling X",
    async (_name, socialConnection) => {
      socialPostFindFirstMock.mockReset();
      socialPostFindFirstMock
        .mockResolvedValueOnce({ ...duePost, socialConnection })
        .mockResolvedValue(null);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ claimed: 1, failed: 1 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            outcome: "connection_inactive",
            finishedAt: NOW,
          }),
        }),
      );
      expect(settleCall()).toEqual({
        where: { id: POST_ID, leaseToken: claimCall().data.leaseToken },
        data: {
          status: "FAILED",
          lastError: "Social connection needs reconnecting",
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          revision: { increment: 1 },
        },
      });
    },
  );

  it("re-schedules a transient failure with a backoff and records the attempt", async () => {
    publishXPostMock.mockRejectedValue(
      new ComposioApiError(429, undefined, "publish X post failed (429)"),
    );
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: {
        finishedAt: NOW,
        outcome: "failed_transient",
        errorKind: "rate_limited",
        providerOutcome: "publish X post failed (429)",
        externalId: null,
      },
    });
    expect(settleCall()).toEqual({
      where: { id: POST_ID, leaseToken: claimCall().data.leaseToken },
      data: {
        status: "SCHEDULED",
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        attemptCount: 1,
        lastError: "publish X post failed (429)",
        leaseToken: null,
        leaseExpiresAt: null,
        revision: { increment: 1 },
      },
    });
  });

  it("uses the longer backoff for the second retry", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, attemptCount: 1 })
      .mockResolvedValue(null);
    publishXPostMock.mockRejectedValue(
      new ComposioApiError(503, undefined, "Composio API timed out"),
    );
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ retried: 1 });
    expect(settleCall().data).toMatchObject({
      status: "SCHEDULED",
      nextAttemptAt: new Date(NOW.getTime() + 180_000),
      attemptCount: 2,
    });
  });

  it("fails permanently on the third transient failure", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({ ...duePost, attemptCount: 2 })
      .mockResolvedValue(null);
    publishXPostMock.mockRejectedValue(
      new ComposioApiError(502, undefined, "publish X post failed (502)"),
    );
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ retried: 0, failed: 1 });
    expect(attemptUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "provider_unavailable",
        }),
      }),
    );
    expect(settleCall().data).toEqual({
      status: "FAILED",
      lastError: "publish X post failed (502)",
      attemptCount: 3,
      nextAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    });
  });

  it("fails permanently when a retry would land outside the retry window", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...duePost,
        scheduledAt: new Date(NOW.getTime() - 14.5 * 60_000),
      })
      .mockResolvedValue(null);
    publishXPostMock.mockRejectedValue(
      new ComposioApiError(429, undefined, "publish X post failed (429)"),
    );
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ retried: 0, failed: 1 });
    expect(settleCall().data.status).toBe("FAILED");
  });

  it("fails permanently on a rejected post at the first try", async () => {
    publishXPostMock.mockRejectedValue(
      new ComposioToolError({
        message: "X refused the post",
        providerMessage: "Duplicate content",
        providerStatus: 403,
      }),
    );
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ retried: 0, failed: 1 });
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      data: {
        finishedAt: NOW,
        outcome: "failed_permanent",
        errorKind: "rejected",
        providerOutcome: "X rejected the post (403): Duplicate content",
        externalId: null,
      },
    });
    expect(settleCall().data).toEqual({
      status: "FAILED",
      lastError: "X rejected the post (403): Duplicate content",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    });
  });

  it("redacts provider secrets from both persisted failure summaries", async () => {
    const opaqueId = "opaque_1234567890abcdefghijklmnopqrstuvwxyz";
    publishXPostMock.mockRejectedValue(
      new ComposioToolError({
        message: "X refused the post",
        providerMessage: `Duplicate content session sess_1 Bearer bearer-secret api_key=api-secret https://internal.example/path ${opaqueId} {"access_token":"short-secret","client_secret":"client-secret","authorization":"Basic dXNlcjpwYXNz","password":"my secret"}`,
        providerStatus: 403,
      }),
    );
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    const providerOutcome = attemptUpdateMock.mock.calls[0]?.[0].data
      .providerOutcome as string;
    const lastError = settleCall().data.lastError as string;
    for (const persistedValue of [providerOutcome, lastError]) {
      expect(persistedValue).toContain("Duplicate content");
      expect(persistedValue).not.toContain("sess_1");
      expect(persistedValue).not.toContain("bearer-secret");
      expect(persistedValue).not.toContain("api-secret");
      expect(persistedValue).not.toContain("internal.example");
      expect(persistedValue).not.toContain(opaqueId);
      expect(persistedValue).not.toContain("short-secret");
      expect(persistedValue).not.toContain("client-secret");
      expect(persistedValue).not.toContain("dXNlcjpwYXNz");
      expect(persistedValue).not.toContain("my secret");
    }
  });

  describe("media", () => {
    function claimWithMedia(media: unknown[]) {
      socialPostFindFirstMock.mockReset();
      socialPostFindFirstMock
        .mockResolvedValueOnce({ ...duePost, media })
        .mockResolvedValue(null);
    }

    it("passes the stored media refs to the adapter without downloading them", async () => {
      const second = { ...IMAGE_REF, name: "second.png" };
      claimWithMedia([IMAGE_REF, second]);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ published: 1 });
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
      expect(publishXPostMock).toHaveBeenCalledWith(
        expect.objectContaining({ media: [IMAGE_REF, second] }),
      );
    });

    it("does not contact the provider when coworker access is revoked before dispatch", async () => {
      socialPostFindFirstMock
        .mockReset()
        .mockResolvedValueOnce({
          ...duePost,
          media: [IMAGE_REF],
          scheduledByUserId: USER_ID,
          scheduledByCoworker: { id: "cow_123", vendorId: "vendor_123" },
          workspace: { organizationId: null },
        })
        .mockResolvedValue(null);
      publishingAccessMock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(forbidden("Grant revoked"));
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1, published: 0 });
      expect(publishingAccessMock).toHaveBeenCalledTimes(2);
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: {
          finishedAt: NOW,
          outcome: "authorization_revoked",
          errorKind: null,
          providerOutcome: null,
          externalId: null,
        },
      });
      expect(settleCall().data).toMatchObject({
        status: "FAILED",
        nextAttemptAt: null,
      });
    });

    it("fails permanently when stored media violates the provider rules", async () => {
      claimWithMedia([IMAGE_REF, CLIP_REF]);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1, retried: 0 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_type_mismatch",
          providerOutcome:
            "The attached media no longer matches X publishing rules",
        }),
      });
      expect(settleCall().data.status).toBe("FAILED");
    });

    it("fails permanently when the stored media cannot be read", async () => {
      claimWithMedia([{ pathname: 1 }]);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_missing",
        }),
      });
    });

    it("fails permanently when a TikTok post has no video", async () => {
      socialPostFindFirstMock.mockReset();
      socialPostFindFirstMock
        .mockResolvedValueOnce({ ...duePost, provider: "tiktok", media: [] })
        .mockResolvedValue(null);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1, published: 0 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_missing",
          providerOutcome: "TikTok requires a video",
        }),
      });
    });
  });

  it("skips a post another worker claimed first", async () => {
    socialPostUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      failed: 0,
      missed: 0,
      skipped: 1,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(attemptCreateMock).not.toHaveBeenCalled();
  });

  it("does not overwrite a post whose lease was lost mid-publish", async () => {
    socialPostUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ claimed: 1, published: 0, skipped: 1 });
    expect(socialPostUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(attemptUpdateMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("lease"),
      expect.objectContaining({ postId: POST_ID }),
    );
  });

  it("stops claiming once the sync context asks to stop", async () => {
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts({
      ...syncContext,
      shouldContinue: () => false,
    });

    expect(result).toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      failed: 0,
      missed: 0,
      skipped: 0,
    });
    expect(socialPostFindFirstMock).not.toHaveBeenCalled();
  });

  describe("publishSocialPostNow", () => {
    const failedPost = {
      ...duePost,
      status: "FAILED",
      attemptCount: 3,
      lastError: "publish X post failed (502)",
      revision: 4,
    };

    beforeEach(() => {
      socialPostFindFirstMock.mockReset();
      socialPostFindFirstMock.mockResolvedValue(failedPost);
    });

    describe.each(["closingAt", "closedAt"])("a Project with %s", (field) => {
      it.each(["DRAFT", "SCHEDULED", "FAILED", "MISSED"])(
        "rejects publishing a %s post",
        async (status) => {
          projectFindFirstMock.mockResolvedValue({
            id: PROJECT_ID,
            [field]: NOW,
          });
          socialPostFindFirstMock.mockResolvedValue({ ...failedPost, status });
          const { publishSocialPostNow } = await loadService();

          await expect(
            publishSocialPostNow({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              postId: POST_ID,
              revision: 4,
            }),
          ).rejects.toMatchObject({
            status: 409,
            message:
              "Cannot publish Social posts in a closing or closed Project",
          });
          expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
          expect(attemptCreateMock).not.toHaveBeenCalled();
          expect(publishXPostMock).not.toHaveBeenCalled();
        },
      );
    });

    it("resets a failed post, claims it, and publishes inline", async () => {
      const { publishSocialPostNow } = await loadService();

      const post = await publishSocialPostNow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        revision: 4,
      });

      expect(socialPostFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: POST_ID,
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
          },
        }),
      );
      expect(claimCall()).toEqual({
        where: { id: POST_ID, revision: 4 },
        data: {
          status: "PUBLISHING",
          scheduledAt: NOW,
          scheduledByUserId: USER_ID,
          scheduledByCoworkerId: null,
          attemptCount: 0,
          nextAttemptAt: null,
          lastError: null,
          needsAttentionReason: null,
          leaseToken: expect.any(String),
          leaseExpiresAt: new Date(NOW.getTime() + 5 * 60_000),
          lastAttemptAt: NOW,
          revision: { increment: 1 },
        },
      });
      expect(attemptCreateMock).toHaveBeenCalledWith({
        data: {
          socialPostId: POST_ID,
          attempt: 1,
          trigger: "publish_now",
          actorUserId: USER_ID,
          toolSlug: "TWITTER_CREATION_OF_A_POST",
        },
        select: { id: true },
      });
      expect(publishXPostMock).toHaveBeenCalledTimes(1);
      expect(settleCall()).toMatchObject({
        where: { id: POST_ID, leaseToken: claimCall().data.leaseToken },
        data: { status: "PUBLISHED", attemptCount: 1 },
      });
      expect(getSocialPostMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        postId: POST_ID,
      });
      expect(post).toEqual({ id: POST_ID, status: "PUBLISHED" });
    });

    it("returns the failed post when X rejects a publish-now", async () => {
      publishXPostMock.mockRejectedValue(
        new ComposioToolError({
          message: "X refused the post",
          providerMessage: "Duplicate content",
        }),
      );
      getSocialPostMock.mockResolvedValue({ id: POST_ID, status: "FAILED" });
      const { publishSocialPostNow } = await loadService();

      const post = await publishSocialPostNow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        postId: POST_ID,
        revision: 4,
      });

      expect(settleCall().data).toMatchObject({
        status: "FAILED",
        attemptCount: 1,
      });
      expect(post).toEqual({ id: POST_ID, status: "FAILED" });
    });

    it("rejects a stale revision before claiming", async () => {
      const { publishSocialPostNow } = await loadService();

      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 3,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Social post was modified, reload and retry",
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("maps a lost claim race to the same conflict", async () => {
      socialPostUpdateManyMock.mockResolvedValueOnce({ count: 0 });
      const { publishSocialPostNow } = await loadService();

      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 4,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Social post was modified, reload and retry",
      });
      expect(publishXPostMock).not.toHaveBeenCalled();
    });

    it("returns not found for a post outside the Project", async () => {
      socialPostFindFirstMock.mockResolvedValue(null);
      const { publishSocialPostNow } = await loadService();

      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 4,
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: "Social post not found",
      });
    });

    it.each(["NEEDS_APPROVAL", "PUBLISHING", "PUBLISHED", "CANCELED"])(
      "refuses to publish a %s post now",
      async (status) => {
        socialPostFindFirstMock.mockResolvedValue({ ...failedPost, status });
        const { publishSocialPostNow } = await loadService();

        await expect(
          publishSocialPostNow({
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            userId: USER_ID,
            postId: POST_ID,
            revision: 4,
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
      },
    );

    it("requires an active connection to publish a draft now", async () => {
      socialPostFindFirstMock.mockResolvedValue({
        ...failedPost,
        status: "DRAFT",
        scheduledAt: null,
        socialConnection: {
          ...activeConnection,
          status: "reauthorization_required",
        },
      });
      const { publishSocialPostNow } = await loadService();

      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 4,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Social connection is not active",
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    });

    it("requires a connection to publish a draft now", async () => {
      socialPostFindFirstMock.mockResolvedValue({
        ...failedPost,
        status: "DRAFT",
        scheduledAt: null,
        socialConnection: null,
      });
      const { publishSocialPostNow } = await loadService();

      await expect(
        publishSocialPostNow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          postId: POST_ID,
          revision: 4,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: "A social connection is required to publish a post",
      });
      expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
    });

    it.each([
      ["tiktok", "TikTok requires a video"],
      ["youtube", "YouTube requires a video"],
      ["instagram", "Instagram requires at least one image or video"],
    ] as const)(
      "refuses to publish a %s draft now without required media",
      async (provider, message) => {
        socialPostFindFirstMock.mockResolvedValue({
          ...failedPost,
          status: "DRAFT",
          provider,
          media: [],
          scheduledAt: null,
          socialConnection: activeConnection,
        });
        const { publishSocialPostNow } = await loadService();

        await expect(
          publishSocialPostNow({
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            userId: USER_ID,
            postId: POST_ID,
            revision: 4,
          }),
        ).rejects.toMatchObject({ status: 400, message });
        expect(socialPostUpdateManyMock).not.toHaveBeenCalled();
        expect(publishXPostMock).not.toHaveBeenCalled();
      },
    );
  });
  it("checks delegation immediately before publishing a coworker-scheduled post", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({
        ...duePost,
        scheduledByUserId: USER_ID,
        scheduledByCoworker: { id: "cow_123", vendorId: "vendor_123" },
        workspace: { organizationId: null },
      })
      .mockResolvedValue(null);
    publishingAccessMock.mockResolvedValue(undefined);
    const { publishDueSocialPosts } = await loadService();
    const result = await publishDueSocialPosts(syncContext);
    expect(publishingAccessMock).toHaveBeenCalledWith(
      {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: "vendor_123",
        context: { userId: USER_ID, organizationId: null },
      },
      WORKSPACE_ID,
    );
    expect(result.published).toBe(1);
  });
  it("fails revoked coworker schedules without contacting X", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({
        ...duePost,
        scheduledByUserId: USER_ID,
        scheduledByCoworker: { id: "cow_123", vendorId: "vendor_123" },
        workspace: { organizationId: null },
      })
      .mockResolvedValue(null);
    publishingAccessMock.mockRejectedValue(forbidden("Grant revoked"));
    const { publishDueSocialPosts } = await loadService();
    const result = await publishDueSocialPosts(syncContext);
    expect(result.failed).toBe(1);
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(settleCall().data).toMatchObject({
      status: "FAILED",
      nextAttemptAt: null,
    });
    expect(attemptCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "authorization_revoked",
          toolSlug: null,
        }),
      }),
    );
  });

  it("claims and fails a coworker schedule whose contextual user was deleted", async () => {
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({
        ...duePost,
        scheduledByUserId: null,
        scheduledByCoworker: { id: "cow_123", vendorId: "vendor_123" },
        workspace: { organizationId: null },
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    const result = await publishDueSocialPosts(syncContext);

    expect(result).toMatchObject({ claimed: 1, failed: 1, published: 0 });
    expect(publishingAccessMock).not.toHaveBeenCalled();
    expect(publishXPostMock).not.toHaveBeenCalled();
    expect(attemptCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "authorization_revoked",
          toolSlug: null,
        }),
      }),
    );
    expect(settleCall().data).toMatchObject({
      status: "FAILED",
      nextAttemptAt: null,
    });
  });
});
