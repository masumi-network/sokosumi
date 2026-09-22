import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict, forbidden, notFound, unauthorized } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountCancelSocialPost from "./[postId]/cancel/post.js";
import mountGetSocialPost from "./[postId]/get.js";
import mountPatchSocialPost from "./[postId]/patch.js";
import mountScheduleSocialPost from "./[postId]/schedule/post.js";
import mountListSocialPosts from "./get.js";
import mountCreateSocialPost from "./post.js";

const {
  cancelSocialPostMock,
  createSocialPostMock,
  getSocialPostMock,
  listSocialPostsMock,
  requireCalendarBetaAccessMock,
  scheduleSocialPostMock,
  updateSocialPostMock,
} = vi.hoisted(() => ({
  cancelSocialPostMock: vi.fn(),
  createSocialPostMock: vi.fn(),
  getSocialPostMock: vi.fn(),
  listSocialPostsMock: vi.fn(),
  requireCalendarBetaAccessMock: vi.fn(),
  scheduleSocialPostMock: vi.fn(),
  updateSocialPostMock: vi.fn(),
}));

vi.mock("@/services/social-posts.service", () => ({
  cancelSocialPost: cancelSocialPostMock,
  createSocialPost: createSocialPostMock,
  getSocialPost: getSocialPostMock,
  listSocialPosts: listSocialPostsMock,
  scheduleSocialPost: scheduleSocialPostMock,
  updateSocialPost: updateSocialPostMock,
}));

vi.mock("@/helpers/calendar-beta-access", () => ({
  requireCalendarBetaAccess: requireCalendarBetaAccessMock,
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
  revision: 0,
  createdAt: new Date("2026-09-15T10:00:00.000Z"),
  updatedAt: new Date("2026-09-15T10:00:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: true,
};

const scheduledPost = {
  ...draftPost,
  status: "SCHEDULED",
  scheduledAt: new Date(SCHEDULED_AT),
  timezone: "Europe/Zurich",
  socialConnection: {
    id: SOCIAL_CONNECTION_ID,
    externalHandle: "sokosumi",
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
  mountGetSocialPost(app);
  mountPatchSocialPost(app);
  mountScheduleSocialPost(app);
  mountCancelSocialPost(app);

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
  ];
}

function expectNoServiceCalls() {
  expect(listSocialPostsMock).not.toHaveBeenCalled();
  expect(createSocialPostMock).not.toHaveBeenCalled();
  expect(getSocialPostMock).not.toHaveBeenCalled();
  expect(updateSocialPostMock).not.toHaveBeenCalled();
  expect(scheduleSocialPostMock).not.toHaveBeenCalled();
  expect(cancelSocialPostMock).not.toHaveBeenCalled();
}

describe("Project social post routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCalendarBetaAccessMock.mockResolvedValue(undefined);
    listSocialPostsMock.mockResolvedValue({
      posts: [draftPost],
      pagination: { cursor: null, nextCursor: null, limit: 20, total: 1 },
    });
    createSocialPostMock.mockResolvedValue(draftPost);
    getSocialPostMock.mockResolvedValue(draftPost);
    updateSocialPostMock.mockResolvedValue({ ...draftPost, revision: 1 });
    scheduleSocialPostMock.mockResolvedValue(scheduledPost);
    cancelSocialPostMock.mockResolvedValue({
      ...scheduledPost,
      status: "CANCELED",
      canceledAt: new Date("2026-09-15T11:00:00.000Z"),
      revision: 2,
      canEdit: false,
      canSchedule: false,
      canCancel: false,
    });
  });

  it("rejects every operation without authentication", async () => {
    const responses = await Promise.all(allOperations(createApp(null)));

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401, 401,
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
      403, 403, 403, 403, 403, 403,
    ]);
    expect(requireCalendarBetaAccessMock).not.toHaveBeenCalled();
    expectNoServiceCalls();
  });

  it("gates every operation behind Calendar beta access", async () => {
    requireCalendarBetaAccessMock.mockRejectedValue(
      forbidden("Calendar is only available to utxo AG workspace members"),
    );

    const responses = await Promise.all(allOperations(createApp()));

    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403,
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
    expect(requireCalendarBetaAccessMock).toHaveBeenCalledWith(
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
      text: "Hello world",
      socialConnectionId: undefined,
      scheduledAt: undefined,
      timezone: undefined,
    });
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
      json("POST", { text: "x".repeat(281) }),
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

    expect(
      [empty, tooLong, badDate, badZone, badProject].map((r) => r.status),
    ).toEqual([422, 422, 422, 422, 422]);
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
      conflict("Social post was modified, reload and retry"),
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
});
