import { OpenAPIHono } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict, forbidden, notFound, unauthorized } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountApproveSocialPost from "./[postId]/approve/post.js";
import mountCancelSocialPost from "./[postId]/cancel/post.js";
import mountDuplicateSocialPost from "./[postId]/duplicate/post.js";
import mountGetSocialPost from "./[postId]/get.js";
import mountPatchSocialPost from "./[postId]/patch.js";
import mountPublishSocialPost from "./[postId]/publish/post.js";
import mountRejectSocialPost from "./[postId]/reject/post.js";
import mountScheduleSocialPost from "./[postId]/schedule/post.js";
import mountRefreshStatistics from "./[postId]/statistics/refresh/post.js";
import mountResumeThread from "./[postId]/thread/resume/post.js";
import mountListSocialPosts from "./get.js";
import mountCreateSocialPost from "./post.js";
import mountStatistics from "./statistics/get.js";

const {
  requireAuthorizedUserContextMock,
  requireCoworkerCapabilityMock,
  approveSocialPostMock,
  cancelSocialPostMock,
  createSocialPostMock,
  duplicateSocialPostMock,
  getSocialPostMock,
  listSocialPostStatisticsMock,
  refreshSocialPostStatisticsMock,
  listSocialPostsMock,
  publishSocialPostNowMock,
  resumeSocialPostThreadMock,
  rejectSocialPostMock,
  requireSocialBetaAccessMock,
  scheduleSocialPostMock,
  updateSocialPostMock,
} = vi.hoisted(() => ({
  requireAuthorizedUserContextMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  approveSocialPostMock: vi.fn(),
  cancelSocialPostMock: vi.fn(),
  createSocialPostMock: vi.fn(),
  duplicateSocialPostMock: vi.fn(),
  getSocialPostMock: vi.fn(),
  listSocialPostStatisticsMock: vi.fn(),
  refreshSocialPostStatisticsMock: vi.fn(),
  listSocialPostsMock: vi.fn(),
  publishSocialPostNowMock: vi.fn(),
  resumeSocialPostThreadMock: vi.fn(),
  rejectSocialPostMock: vi.fn(),
  requireSocialBetaAccessMock: vi.fn(),
  scheduleSocialPostMock: vi.fn(),
  updateSocialPostMock: vi.fn(),
}));

vi.mock("@/services/social-post-publisher.service", () => ({
  publishSocialPostNow: publishSocialPostNowMock,
}));

vi.mock("@/services/social-posts.service", () => ({
  approveSocialPost: approveSocialPostMock,
  cancelSocialPost: cancelSocialPostMock,
  createSocialPost: createSocialPostMock,
  duplicateSocialPost: duplicateSocialPostMock,
  getSocialPost: getSocialPostMock,
  listSocialPosts: listSocialPostsMock,
  resumeSocialPostThread: resumeSocialPostThreadMock,
  rejectSocialPost: rejectSocialPostMock,
  scheduleSocialPost: scheduleSocialPostMock,
  updateSocialPost: updateSocialPostMock,
}));

vi.mock("@/services/social-post-statistics.service", () => ({
  listSocialPostStatistics: listSocialPostStatisticsMock,
  refreshSocialPostStatistics: refreshSocialPostStatisticsMock,
}));

vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: requireSocialBetaAccessMock,
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: requireAuthorizedUserContextMock,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const SOCIAL_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_123";
const SCHEDULED_AT = "2026-09-16T10:00:00.000Z";

const SESSION_AUTH: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const USER_API_KEY_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "api_key",
};

const OAUTH_TOKEN_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "oauth",
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "vendor_123",
  context: { userId: USER_ID, organizationId: null },
};

const SOKO_BOT_CONTEXT_AUTH: AuthenticationContext = {
  actor: "sokoBot",
  scope: "personal",
  sokoBotId: "bot_123",
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  organizationId: null,
};

const WORKSPACE_CONTEXT: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
};

const draftPost = {
  id: POST_ID,
  projectId: PROJECT_ID,
  provider: "x",
  text: "Hello world",
  firstComment: null,
  media: [],
  threadParts: [],
  threadPartCount: 1,
  publishedThreadPartCount: 0,
  failedThreadPartPosition: null,
  partiallyPublished: false,
  publishingThreadPartPosition: null,
  status: "DRAFT",
  scheduledAt: null,
  timezone: null,
  socialConnection: null,
  creator: { kind: "user", id: USER_ID, name: "Ada Lovelace" },
  scheduledByUserId: null,
  canceledAt: null,
  publishedAt: null,
  publishedExternalId: null,
  publishedUrl: null,
  lastError: null,
  attemptCount: 0,
  nextAttemptAt: null,
  lastAttemptAt: null,
  lastAttempt: null,
  revision: 0,
  createdAt: new Date("2026-09-15T10:00:00.000Z"),
  updatedAt: new Date("2026-09-15T10:00:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: true,
  canPublishNow: true,
  canApprove: false,
  canReject: false,
  canDuplicate: false,
  connectionNeedsReconnect: false,
};

const scheduledPost = {
  ...draftPost,
  status: "SCHEDULED",
  scheduledAt: new Date(SCHEDULED_AT),
  timezone: "Europe/Zurich",
  socialConnection: {
    id: SOCIAL_CONNECTION_ID,
    externalHandle: "sokosumi",
    displayName: null,
    avatarUrl: null,
    subscriptionType: null,
    status: "active",
  },
  scheduledByUserId: USER_ID,
  revision: 1,
};

function createApp(
  authContext: AuthenticationContext | null = SESSION_AUTH,
  workspaceContext: WorkspaceContext | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    if (!authContext) {
      throw unauthorized("Unauthorized");
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    await next();
  });

  mountListSocialPosts(app);
  mountCreateSocialPost(app);
  mountStatistics(app);
  mountRefreshStatistics(app);
  mountGetSocialPost(app);
  mountPatchSocialPost(app);
  mountScheduleSocialPost(app);
  mountApproveSocialPost(app);
  mountResumeThread(app);
  mountRejectSocialPost(app);
  mountCancelSocialPost(app);
  mountDuplicateSocialPost(app);
  mountPublishSocialPost(app);

  return app;
}

function json(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function allOperations(app: ReturnType<typeof createApp>) {
  const base = `http://localhost/${PROJECT_ID}/social-posts`;
  return [
    app.request(base),
    app.request(base, json("POST", { text: "Hello world" })),
    app.request(`${base}/${POST_ID}`),
    app.request(`${base}/${POST_ID}`, json("PATCH", { revision: 0 })),
    app.request(
      `${base}/${POST_ID}/schedule`,
      json("POST", { scheduledAt: SCHEDULED_AT, revision: 0 }),
    ),
    app.request(`${base}/${POST_ID}/cancel`, json("POST", { revision: 0 })),
    app.request(`${base}/${POST_ID}/approve`, json("POST", { revision: 0 })),
    app.request(`${base}/${POST_ID}/reject`, json("POST", { revision: 0 })),
    app.request(`${base}/${POST_ID}/duplicate`, { method: "POST" }),
    app.request(`${base}/${POST_ID}/publish`, json("POST", { revision: 0 })),
  ];
}

function expectNoServiceCalls() {
  expect(listSocialPostsMock).not.toHaveBeenCalled();
  expect(createSocialPostMock).not.toHaveBeenCalled();
  expect(getSocialPostMock).not.toHaveBeenCalled();
  expect(updateSocialPostMock).not.toHaveBeenCalled();
  expect(scheduleSocialPostMock).not.toHaveBeenCalled();
  expect(cancelSocialPostMock).not.toHaveBeenCalled();
  expect(approveSocialPostMock).not.toHaveBeenCalled();
  expect(rejectSocialPostMock).not.toHaveBeenCalled();
  expect(duplicateSocialPostMock).not.toHaveBeenCalled();
  expect(publishSocialPostNowMock).not.toHaveBeenCalled();
}

describe("Project social post routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthorizedUserContextMock.mockRejectedValue(
      forbidden("Coworker delegation required"),
    );
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    requireSocialBetaAccessMock.mockResolvedValue(undefined);
    listSocialPostsMock.mockResolvedValue({
      posts: [draftPost],
      pagination: { cursor: null, nextCursor: null, limit: 20, total: 1 },
    });
    createSocialPostMock.mockResolvedValue(draftPost);
    getSocialPostMock.mockResolvedValue(draftPost);
    updateSocialPostMock.mockResolvedValue({ ...draftPost, revision: 1 });
    scheduleSocialPostMock.mockResolvedValue(scheduledPost);
    approveSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      revision: 2,
    });
    rejectSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      status: "CANCELED",
      canceledAt: new Date("2026-09-15T11:00:00.000Z"),
      revision: 2,
      canEdit: false,
      canSchedule: false,
      canCancel: false,
      canApprove: false,
      canReject: false,
    });
    duplicateSocialPostMock.mockResolvedValue({
      ...draftPost,
      id: "55555555-5555-4555-8555-555555555555",
    });
    cancelSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      status: "CANCELED",
      canceledAt: new Date("2026-09-15T11:00:00.000Z"),
      revision: 2,
      canEdit: false,
      canSchedule: false,
      canCancel: false,
    });
    publishSocialPostNowMock.mockResolvedValue({
      ...scheduledPost,
      status: "PUBLISHED",
      publishedAt: new Date("2026-09-15T11:00:00.000Z"),
      publishedExternalId: "1907",
      publishedUrl: "https://x.com/sokosumi/status/1907",
      attemptCount: 1,
      lastAttemptAt: new Date("2026-09-15T11:00:00.000Z"),
      lastAttempt: {
        attempt: 1,
        trigger: "publish_now",
        outcome: "succeeded",
        errorKind: null,
        providerOutcome: "201 created",
        finishedAt: new Date("2026-09-15T11:00:00.000Z"),
      },
      revision: 3,
      canEdit: false,
      canSchedule: false,
      canCancel: false,
      canPublishNow: false,
      canDuplicate: true,
    });
  });

  it("rejects every operation without authentication", async () => {
    const responses = await Promise.all(allOperations(createApp(null)));

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401, 401, 401, 401, 401, 401,
    ]);
    expectNoServiceCalls();
  });

  it.each([
    ["coworker", COWORKER_CONTEXT_AUTH],
    ["Soko Bot", SOKO_BOT_CONTEXT_AUTH],
    ["user API key", USER_API_KEY_AUTH],
    ["OAuth token", OAUTH_TOKEN_AUTH],
  ] as const)("rejects %s before every operation", async (_name, auth) => {
    const responses = await Promise.all(allOperations(createApp(auth)));

    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403, 403, 403,
    ]);
    expect(requireSocialBetaAccessMock).not.toHaveBeenCalled();
    expectNoServiceCalls();
  });

  it("gates every operation behind Social beta access", async () => {
    requireSocialBetaAccessMock.mockRejectedValue(
      forbidden("Calendar is only available to utxo AG workspace members"),
    );

    const responses = await Promise.all(allOperations(createApp()));

    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403, 403, 403,
    ]);
    expectNoServiceCalls();
  });

  it("rejects a missing workspace", async () => {
    const response = await createApp(SESSION_AUTH, null).request(
      `http://localhost/${PROJECT_ID}/social-posts`,
    );

    expect(response.status).toBe(403);
    expectNoServiceCalls();
  });

  it("passes ordered thread parts through create and update", async () => {
    const threadParts = [{ text: "Second", media: [] }, { text: "Third" }];
    const app = createApp();
    const created = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Head", threadParts }),
      },
    );
    const updated = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadParts, revision: 0 }),
      },
    );
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(createSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ threadParts }),
    );
    expect(updateSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ threadParts }),
    );
  });

  it("reads thread parts, dates, and partial progress", async () => {
    const threadParts = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        position: 2,
        text: "Second",
        media: [],
        externalPostId: "1908",
        publishedAt: new Date(SCHEDULED_AT),
        error: null,
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        position: 3,
        text: "Third",
        media: [],
        externalPostId: null,
        publishedAt: null,
        error: "Thread part 3 failed",
      },
    ];
    getSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      status: "FAILED",
      publishedExternalId: "1907",
      threadParts,
      threadPartCount: 3,
      publishedThreadPartCount: 2,
      failedThreadPartPosition: 3,
      partiallyPublished: true,
    });
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      threadParts: [
        { ...threadParts[0], publishedAt: SCHEDULED_AT },
        threadParts[1],
      ],
      threadPartCount: 3,
      publishedThreadPartCount: 2,
      failedThreadPartPosition: 3,
      partiallyPublished: true,
    });
  });

  it("rejects more than 25 total parts at the request boundary", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Head",
          threadParts: Array.from({ length: 25 }, () => ({ text: "Part" })),
        }),
      },
    );
    expect(response.status).toBe(422);
    expect(createSocialPostMock).not.toHaveBeenCalled();
  });

  it("lists posts for the Project with an optional status filter", async () => {
    const app = createApp();
    const unfiltered = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
    );
    const filtered = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts?status=DRAFT,SCHEDULED`,
    );

    expect(unfiltered.status).toBe(200);
    const body = await unfiltered.json();
    expect(body.data).toEqual([
      {
        ...draftPost,
        createdAt: "2026-09-15T10:00:00.000Z",
        updatedAt: "2026-09-15T10:00:00.000Z",
      },
    ]);
    expect(filtered.status).toBe(200);
    expect(requireSocialBetaAccessMock).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
    );
    expect(listSocialPostsMock).toHaveBeenNthCalledWith(1, {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      statuses: undefined,
      cursor: undefined,
      limit: 20,
    });
    expect(listSocialPostsMock).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      statuses: ["DRAFT", "SCHEDULED"],
      cursor: undefined,
      limit: 20,
    });
  });

  it("rejects an unknown status filter", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts?status=DRAFT,LIVE`,
    );

    expect(response.status).toBe(422);
    expect(listSocialPostsMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts?cursor=not-a-uuid`,
    );

    expect(response.status).toBe(422);
    expect(listSocialPostsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", null, 401],
    ["bare API key", USER_API_KEY_AUTH, 403],
    ["ungranted Coworker", COWORKER_CONTEXT_AUTH, 403],
    ["direct Soko Bot REST", SOKO_BOT_CONTEXT_AUTH, 403],
  ] as const)(
    "blocks statistics access for %s",
    async (_name, auth, status) => {
      const app = createApp(auth);
      const base = `http://localhost/${PROJECT_ID}/social-posts`;
      expect((await app.request(`${base}/statistics`)).status).toBe(status);
      expect(
        (
          await app.request(`${base}/${POST_ID}/statistics/refresh`, {
            method: "POST",
          })
        ).status,
      ).toBe(status);
      expect(listSocialPostStatisticsMock).not.toHaveBeenCalled();
      expect(refreshSocialPostStatisticsMock).not.toHaveBeenCalled();
    },
  );

  it("allows a delegated Coworker to read and refresh workspace statistics", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({ userId: USER_ID });
    listSocialPostStatisticsMock.mockResolvedValue({
      posts: [draftPost],
      summary: [],
      nextCursor: null,
    });
    refreshSocialPostStatisticsMock.mockResolvedValue(draftPost);
    const app = createApp(COWORKER_CONTEXT_AUTH);
    const base = `http://localhost/${PROJECT_ID}/social-posts`;
    const response = await app.request(
      `${base}/statistics?provider=x&publishedFrom=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(200);
    expect(listSocialPostStatisticsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        provider: "x",
        publishedFrom: new Date("2026-10-01T00:00:00Z"),
      }),
    );
    expect(
      (
        await app.request(`${base}/${POST_ID}/statistics/refresh`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(refreshSocialPostStatisticsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      postId: POST_ID,
      userId: USER_ID,
    });
  });

  it("rejects invalid publication ranges before statistics reads", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/statistics?publishedFrom=2026-10-08T00:00:00Z&publishedUntil=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(422);
    expect(listSocialPostStatisticsMock).not.toHaveBeenCalled();
  });

  it("creates a draft", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "Hello world" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { id: POST_ID, status: "DRAFT" },
    });
    expect(createSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      text: "Hello world",
      socialConnectionId: undefined,
      scheduledAt: undefined,
      timezone: undefined,
    });
  });

  it("forwards Drive media on create and returns it on the post", async () => {
    const mediaRef = {
      pathname: `drive/users/${USER_ID}/launch.png`,
      fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/launch.png`,
      name: "launch.png",
      size: 2048,
      mimeType: "image/png",
      kind: "image" as const,
    };
    createSocialPostMock.mockResolvedValue({ ...draftPost, media: [mediaRef] });
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "Hello world", media: [mediaRef] }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { media: [mediaRef] },
    });
    expect(createSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ media: [mediaRef] }),
    );
  });

  it("creates a scheduled post with a parsed date", async () => {
    createSocialPostMock.mockResolvedValue(scheduledPost);
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", {
        text: "Hello world",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        scheduledAt: SCHEDULED_AT,
        timezone: "Europe/Zurich",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        status: "SCHEDULED",
        scheduledAt: SCHEDULED_AT,
        socialConnection: { id: SOCIAL_CONNECTION_ID, status: "active" },
      },
    });
    expect(createSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      text: "Hello world",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      scheduledAt: new Date(SCHEDULED_AT),
      timezone: "Europe/Zurich",
    });
  });

  it("validates the create body", async () => {
    const app = createApp();
    const empty = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "   " }),
    );
    const tooLong = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "x".repeat(63207) }),
    );
    const badDate = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "Hello", scheduledAt: "tomorrow" }),
    );
    const badZone = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", { text: "Hello", timezone: "Mars/Olympus" }),
    );
    const badProject = await app.request(
      "http://localhost/not-a-uuid/social-posts",
      json("POST", { text: "Hello" }),
    );
    const tooManyImages = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts`,
      json("POST", {
        text: "Hello",
        media: Array.from({ length: 5 }, (_, index) => ({
          pathname: `drive/users/${USER_ID}/photo-${index}.png`,
          fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/${USER_ID}/photo-${index}.png`,
          name: `photo-${index}.png`,
          size: 2048,
          mimeType: "image/png",
          kind: "image",
        })),
      }),
    );

    expect(
      [empty, tooLong, badDate, badZone, badProject, tooManyImages].map(
        (r) => r.status,
      ),
    ).toEqual([422, 422, 422, 422, 422, 422]);
    expect(createSocialPostMock).not.toHaveBeenCalled();
  });

  it("reads one post", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
    );

    expect(response.status).toBe(200);
    expect(getSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      postId: POST_ID,
    });
  });

  it("reads a post whose last attempt was denied after authorization revocation", async () => {
    getSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      status: "FAILED",
      lastError:
        "Coworker scheduling access was revoked. A workspace member must reschedule this post.",
      lastAttemptAt: new Date("2026-09-15T11:00:00.000Z"),
      lastAttempt: {
        attempt: 1,
        trigger: "scheduler",
        outcome: "authorization_revoked",
        errorKind: null,
        providerOutcome: null,
        finishedAt: new Date("2026-09-15T11:00:00.000Z"),
      },
      revision: 2,
      canEdit: false,
      canSchedule: true,
      canCancel: false,
      canPublishNow: true,
      canApprove: false,
      canReject: false,
      canDuplicate: true,
    });

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        status: "FAILED",
        lastAttempt: {
          outcome: "authorization_revoked",
          finishedAt: "2026-09-15T11:00:00.000Z",
        },
      },
    });
  });

  it("updates a post with the observed revision", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
      json("PATCH", {
        text: "Edited",
        socialConnectionId: null,
        revision: 0,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { revision: 1 } });
    expect(updateSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      postId: POST_ID,
      text: "Edited",
      socialConnectionId: null,
      revision: 0,
    });
  });

  it("requires a revision to update", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
      json("PATCH", { text: "Edited" }),
    );

    expect(response.status).toBe(422);
    expect(updateSocialPostMock).not.toHaveBeenCalled();
  });

  it("schedules a post", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/schedule`,
      json("POST", {
        scheduledAt: SCHEDULED_AT,
        timezone: "Europe/Zurich",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        revision: 0,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { status: "SCHEDULED", scheduledAt: SCHEDULED_AT },
    });
    expect(scheduleSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      scheduledAt: new Date(SCHEDULED_AT),
      timezone: "Europe/Zurich",
      socialConnectionId: SOCIAL_CONNECTION_ID,
      revision: 0,
    });
  });

  it("cancels a post", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/cancel`,
      json("POST", { revision: 1 }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { status: "CANCELED", canCancel: false },
    });
    expect(cancelSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 1,
    });
  });

  it("duplicates a post into a new draft", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/duplicate`,
      { method: "POST" },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { id: "55555555-5555-4555-8555-555555555555", status: "DRAFT" },
    });
    expect(duplicateSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
      postId: POST_ID,
    });
  });

  it("publishes a post now", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/publish`,
      json("POST", { revision: 1 }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        status: "PUBLISHED",
        publishedUrl: "https://x.com/sokosumi/status/1907",
        lastAttempt: {
          attempt: 1,
          trigger: "publish_now",
          outcome: "succeeded",
          finishedAt: "2026-09-15T11:00:00.000Z",
        },
        canPublishNow: false,
      },
    });
    expect(publishSocialPostNowMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 1,
    });
  });

  it("approves a post that needs approval", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/approve`,
      json("POST", { revision: 2 }),
    );

    expect(response.status).toBe(200);
    expect(approveSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 2,
    });
  });

  it("rejects a post that needs approval", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/reject`,
      json("POST", { revision: 2 }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { status: "CANCELED", canApprove: false },
    });
    expect(rejectSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 2,
    });
  });

  it("requires a revision to publish now", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/publish`,
      json("POST", {}),
    );

    expect(response.status).toBe(422);
    expect(publishSocialPostNowMock).not.toHaveBeenCalled();
  });

  it("maps a publish-now revision conflict", async () => {
    publishSocialPostNowMock.mockRejectedValue(
      conflict("Social post was modified, reload and retry"),
    );

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/publish`,
      json("POST", { revision: 0 }),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      "Social post was modified, reload and retry",
    );
  });

  it("rejects a malformed post id", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/not-a-uuid/cancel`,
      json("POST", { revision: 1 }),
    );

    expect(response.status).toBe(422);
    expect(cancelSocialPostMock).not.toHaveBeenCalled();
  });

  it("maps service not-found and conflict errors", async () => {
    getSocialPostMock.mockRejectedValue(notFound("Social post not found"));
    updateSocialPostMock.mockRejectedValue(
      conflict("Social post was modified, reload and retry", {
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
      }),
    );
    const app = createApp();

    const missing = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
    );
    const stale = await app.request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}`,
      json("PATCH", { text: "Edited", revision: 0 }),
    );

    expect(missing.status).toBe(404);
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain(
      "Social post was modified, reload and retry",
    );
  });

  it("hides unexpected service failures", async () => {
    listSocialPostsMock.mockRejectedValue(new Error("database exploded"));

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts`,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("database exploded");
  });
  it("allows an authorized coworker to manage schedules but not publish immediately", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: null,
    });
    const responses = await Promise.all(
      allOperations(createApp(COWORKER_CONTEXT_AUTH)),
    );
    expect(responses.map((response) => response.status)).toEqual([
      200, 201, 200, 200, 200, 200, 403, 403, 201, 403,
    ]);
    expect(createSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, coworkerId: "cow_123" }),
    );
    expect(scheduleSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, coworkerId: "cow_123" }),
    );
    expect(duplicateSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, coworkerId: "cow_123" }),
    );
    expect(requireCoworkerCapabilityMock).toHaveBeenCalledWith(
      "cow_123",
      "tasks",
      expect.anything(),
    );
    const getBody = await responses[2]!.json();
    expect(getBody.data.canPublishNow).toBe(false);
    expect(getBody.data.canApprove).toBe(false);
    expect(getBody.data.canReject).toBe(false);
    expect(publishSocialPostNowMock).not.toHaveBeenCalled();
    expect(approveSocialPostMock).not.toHaveBeenCalled();
    expect(rejectSocialPostMock).not.toHaveBeenCalled();
  });
  it("keeps coworker scheduling beta-gated", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: null,
    });
    requireSocialBetaAccessMock.mockRejectedValue(
      forbidden("Beta access required"),
    );
    const responses = await Promise.all(
      allOperations(createApp(COWORKER_CONTEXT_AUTH)),
    );
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expectNoServiceCalls();
  });
  it("rejects coworkers without the tasks capability", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: null,
    });
    requireCoworkerCapabilityMock.mockRejectedValue(
      forbidden("Capability required"),
    );
    const responses = await Promise.all(
      allOperations(createApp(COWORKER_CONTEXT_AUTH)),
    );
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expectNoServiceCalls();
  });
});

describe("thread resume confirmation", () => {
  beforeEach(() => {
    resumeSocialPostThreadMock.mockReset();
    requireSocialBetaAccessMock.mockReset().mockResolvedValue(undefined);
  });
  const url = `/${PROJECT_ID}/social-posts/${POST_ID}/thread/resume`;
  it("requires an explicit confirmation and observed revision", async () => {
    const app = createApp();
    for (const body of [
      { revision: 0 },
      { revision: 0, confirmedNotPosted: false },
      { confirmedNotPosted: true },
    ]) {
      expect((await app.request(url, json("POST", body))).status).toBe(422);
    }
    expect(resumeSocialPostThreadMock).not.toHaveBeenCalled();
  });

  it("clears the marker through the scoped service and returns the refreshed post", async () => {
    requireSocialBetaAccessMock.mockResolvedValue(undefined);
    resumeSocialPostThreadMock.mockResolvedValue({
      ...draftPost,
      status: "FAILED",
      revision: 1,
    });
    const response = await createApp().request(
      url,
      json("POST", { revision: 0, confirmedNotPosted: true }),
    );
    expect(response.status).toBe(200);
    expect(resumeSocialPostThreadMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
      confirmedNotPosted: true,
    });
    expect((await response.json()).data).toMatchObject({
      publishingThreadPartPosition: null,
      revision: 1,
    });
  });

  it.each([
    COWORKER_CONTEXT_AUTH,
    USER_API_KEY_AUTH,
    OAUTH_TOKEN_AUTH,
    SOKO_BOT_CONTEXT_AUTH,
  ])("requires an interactive human session: %j", async (auth) => {
    expect(
      (
        await createApp(auth).request(
          url,
          json("POST", { revision: 0, confirmedNotPosted: true }),
        )
      ).status,
    ).toBe(403);
  });

  it("requires authentication, beta access and a workspace before touching a post", async () => {
    const body = { revision: 0, confirmedNotPosted: true };
    expect(
      (await createApp(null).request(url, json("POST", body))).status,
    ).toBe(401);
    expect(
      (await createApp(SESSION_AUTH, null).request(url, json("POST", body)))
        .status,
    ).toBe(403);
    requireSocialBetaAccessMock.mockRejectedValue(
      forbidden("Social beta required"),
    );
    expect((await createApp().request(url, json("POST", body))).status).toBe(
      403,
    );
    expect(resumeSocialPostThreadMock).not.toHaveBeenCalled();
  });

  it("propagates conflicts without retrying a post", async () => {
    requireSocialBetaAccessMock.mockResolvedValue(undefined);
    resumeSocialPostThreadMock.mockRejectedValue(conflict("Post changed"));
    const response = await createApp().request(
      url,
      json("POST", { revision: 0, confirmedNotPosted: true }),
    );
    expect(response.status).toBe(409);
  });
});
