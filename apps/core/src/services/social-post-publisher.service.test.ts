import { SsrfError } from "@sokosumi/net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposioApiError,
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/composio.client";

const {
  attemptFindFirstMock,
  attemptAggregateMock,
  attemptCreateMock,
  attemptUpdateMock,
  getSocialPostMock,
  publishXPostMock,
  socialPostFindFirstMock,
  socialPostUpdateManyMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  attemptFindFirstMock: vi.fn(),
  attemptAggregateMock: vi.fn(),
  attemptCreateMock: vi.fn(),
  attemptUpdateMock: vi.fn(),
  getSocialPostMock: vi.fn(),
  publishXPostMock: vi.fn(),
  socialPostFindFirstMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialPost: {
      findFirst: socialPostFindFirstMock,
      updateMany: socialPostUpdateManyMock,
    },
    socialPostPublishAttempt: {
      findFirst: attemptFindFirstMock,
      aggregate: attemptAggregateMock,
      create: attemptCreateMock,
      update: attemptUpdateMock,
    },
  },
}));

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  publishXPost: publishXPostMock,
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
  text: "Hello world",
  media: [],
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    socialPostFindFirstMock
      .mockResolvedValueOnce(duePost)
      .mockResolvedValue(null);
    socialPostUpdateManyMock.mockResolvedValue({ count: 1 });
    attemptFindFirstMock.mockResolvedValue(null);
    attemptAggregateMock.mockResolvedValue({ _max: { attempt: null } });
    attemptCreateMock.mockResolvedValue({ id: ATTEMPT_ID });
    attemptUpdateMock.mockResolvedValue({ id: ATTEMPT_ID });
    publishXPostMock.mockResolvedValue({ externalId: "1907" });
    getSocialPostMock.mockResolvedValue({ id: POST_ID, status: "PUBLISHED" });
    ssrfSafeFetchMock.mockImplementation(async () =>
      mediaResponse(new Uint8Array([1, 2, 3]), "image/png"),
    );
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

  it("cancels a media download without publishing and durably settles the attempt", async () => {
    const controller = new AbortController();
    socialPostFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({ ...duePost, media: [IMAGE_REF] })
      .mockResolvedValue(null);
    ssrfSafeFetchMock.mockImplementation(async (_url, options) => {
      controller.abort();
      options.signal.throwIfAborted();
    });
    const { publishDueSocialPosts } = await loadService();
    await publishDueSocialPosts({
      ...syncContext,
      abortSignal: controller.signal,
    });
    expect(publishXPostMock).not.toHaveBeenCalled();
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
              scheduledByUser: {
                members: { some: { organization: { slug: "utxo" } } },
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
      where: { id: POST_ID, status: "SCHEDULED", revision: 1 },
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
      connectedAccountId: "ca_123",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
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
        providerOutcome: "201 created",
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
        attemptCount: 1,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        revision: { increment: 1 },
      },
    });
  });

  it("falls back to the generic X URL when the handle is unknown", async () => {
    socialPostFindFirstMock.mockReset();
    socialPostFindFirstMock
      .mockResolvedValueOnce({
        ...duePost,
        socialConnection: { ...activeConnection, externalHandle: null },
      })
      .mockResolvedValue(null);
    const { publishDueSocialPosts } = await loadService();

    await publishDueSocialPosts(syncContext);

    expect(settleCall().data.publishedUrl).toBe(
      "https://x.com/i/web/status/1907",
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
              scheduledByUser: {
                members: { some: { organization: { slug: "utxo" } } },
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
      outcome: "connection_inactive",
      providerOutcome: null,
      post: {},
      expectedResult: { retried: 0, failed: 1, missed: 0 },
      expectedData: {
        status: "FAILED",
        lastError: "Social connection needs reconnecting",
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
      new ComposioPublishOutcomeUnknownError(),
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

    it("downloads each Drive file server-side and hands the bytes to X", async () => {
      claimWithMedia([IMAGE_REF, { ...IMAGE_REF, name: "second.png" }]);
      ssrfSafeFetchMock
        .mockResolvedValueOnce(
          mediaResponse(new Uint8Array([1, 2, 3]), "image/png"),
        )
        .mockResolvedValueOnce(
          mediaResponse(new Uint8Array([4, 5, 6]), "image/png; charset=binary"),
        );
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ published: 1 });
      expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
      expect(ssrfSafeFetchMock).toHaveBeenNthCalledWith(
        1,
        IMAGE_REF.fileUrl,
        expect.objectContaining({ maxResponseBytes: 5 * 1024 * 1024 }),
      );
      expect(publishXPostMock).toHaveBeenCalledWith({
        connectedAccountId: "ca_123",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
        text: "Hello world",
        media: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            name: IMAGE_REF.name,
            mimeType: "image/png",
            kind: "image",
          },
          {
            bytes: new Uint8Array([4, 5, 6]),
            name: "second.png",
            mimeType: "image/png",
            kind: "image",
          },
        ],
        signal: expect.any(AbortSignal),
      });
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "succeeded",
          providerOutcome: "201 created, 2 media",
        }),
      });
    });

    it("fails permanently when a Drive file is gone", async () => {
      claimWithMedia([IMAGE_REF]);
      ssrfSafeFetchMock.mockResolvedValue(
        mediaResponse(new Uint8Array(), null, 404),
      );
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1, retried: 0 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: {
          finishedAt: NOW,
          outcome: "failed_permanent",
          errorKind: "media_missing",
          providerOutcome: 'Media file "launch.png" is no longer available',
          externalId: null,
        },
      });
      expect(settleCall().data).toMatchObject({
        status: "FAILED",
        lastError: 'Media file "launch.png" is no longer available',
        attemptCount: 1,
      });
    });

    it("fails permanently when the served content type does not match the kind", async () => {
      claimWithMedia([CLIP_REF]);
      ssrfSafeFetchMock.mockResolvedValue(
        mediaResponse(new Uint8Array([1]), "text/html"),
      );
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_type_mismatch",
          providerOutcome: 'Media file "clip.mp4" is not a video',
        }),
      });
      expect(settleCall().data.status).toBe("FAILED");
    });

    it("fails permanently when a Drive file exceeds the X byte cap", async () => {
      claimWithMedia([IMAGE_REF]);
      ssrfSafeFetchMock.mockRejectedValue(
        new SsrfError("Response body exceeds maxResponseBytes (5242880)"),
      );
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_too_large",
          providerOutcome: 'Media file "launch.png" is too large for X',
        }),
      });
    });

    it("fails permanently when the stored media cannot be read", async () => {
      claimWithMedia([{ pathname: 1 }]);
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ failed: 1 });
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_permanent",
          errorKind: "media_missing",
        }),
      });
    });

    it("retries when the Drive download fails transiently", async () => {
      claimWithMedia([IMAGE_REF]);
      ssrfSafeFetchMock.mockRejectedValue(new Error("socket hang up"));
      const { publishDueSocialPosts } = await loadService();

      const result = await publishDueSocialPosts(syncContext);

      expect(result).toMatchObject({ retried: 1 });
      expect(publishXPostMock).not.toHaveBeenCalled();
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({
          outcome: "failed_transient",
          errorKind: "unknown",
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
          attemptCount: 0,
          nextAttemptAt: null,
          lastError: null,
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

    it.each(["PUBLISHING", "PUBLISHED", "CANCELED"])(
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
  });
});
