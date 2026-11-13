import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountListWorkspaceSocialPosts from "./get.js";

const {
  listWorkspaceSocialPostsMock,
  projectFindManyMock,
  requireAuthorizedUserContextMock,
  requireCoworkerCapabilityMock,
} = vi.hoisted(() => ({
  listWorkspaceSocialPostsMock: vi.fn(),
  projectFindManyMock: vi.fn(),
  requireAuthorizedUserContextMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
}));

vi.mock("@/services/social-posts.service", () => ({
  listWorkspaceSocialPosts: listWorkspaceSocialPostsMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { project: { findMany: projectFindManyMock } },
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: requireAuthorizedUserContextMock,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_123";

const SESSION_AUTH: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const COWORKER_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "vendor_123",
  context: { userId: USER_ID, organizationId: null },
};

const WORKSPACE_CONTEXT: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
};

const failedPost = {
  id: "44444444-4444-4444-8444-444444444444",
  projectId: PROJECT_ID,
  provider: "x",
  text: "Hello world",
  firstComment: null,
  media: [],
  threadParts: [],
  quotedPostId: null,
  quotedPost: null,
  needsAttentionReason: null,
  threadPartCount: 1,
  publishedThreadPartCount: 0,
  failedThreadPartPosition: null,
  partiallyPublished: false,
  publishingThreadPartPosition: null,
  status: "FAILED",
  scheduledAt: new Date("2026-09-16T10:00:00.000Z"),
  timezone: null,
  socialConnection: null,
  creator: { kind: "user", id: USER_ID, name: "Ada Lovelace" },
  scheduledByUserId: USER_ID,
  canceledAt: null,
  publishedAt: null,
  publishedExternalId: null,
  publishedUrl: null,
  lastError: null,
  attemptCount: 1,
  nextAttemptAt: null,
  lastAttemptAt: null,
  lastAttempt: null,
  revision: 2,
  createdAt: new Date("2026-09-15T10:00:00.000Z"),
  updatedAt: new Date("2026-09-15T10:00:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: true,
  canPublishNow: true,
  canApprove: false,
  canReject: false,
  canDuplicate: true,
  connectionNeedsReconnect: false,
};

function createApp(
  authContext: AuthenticationContext = SESSION_AUTH,
  workspaceContext: WorkspaceContext | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    await next();
  });
  mountListWorkspaceSocialPosts(app);
  return app;
}

describe("GET /workspaces/social-posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaceSocialPostsMock.mockResolvedValue({
      posts: [failedPost],
      pagination: { nextCursor: null, hasMore: false, total: 1 },
    });
    projectFindManyMock.mockResolvedValue([
      { id: PROJECT_ID, name: "Spring launch" },
    ]);
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: null,
    });
  });

  it("lists the active workspace's posts with their Project name", async () => {
    const response = await createApp().request(
      "http://localhost/social-posts?status=FAILED,MISSED,NEEDS_APPROVAL",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        projectName: "Spring launch",
        post: expect.objectContaining({
          id: failedPost.id,
          status: "FAILED",
          canPublishNow: true,
        }),
      }),
    ]);
    expect(listWorkspaceSocialPostsMock).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      statuses: ["FAILED", "MISSED", "NEEDS_APPROVAL"],
      cursor: undefined,
      limit: 20,
    });
    // Project names come from the same workspace only.
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, id: { in: [PROJECT_ID] } },
      select: { id: true, name: true },
    });
  });

  it("keeps publish now human-only for a Coworker", async () => {
    const response = await createApp(COWORKER_AUTH).request(
      "http://localhost/social-posts",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].post.canPublishNow).toBe(false);
    expect(requireCoworkerCapabilityMock).toHaveBeenCalledWith(
      "cow_123",
      "tasks",
      expect.anything(),
    );
  });

  it("refuses a request without a workspace", async () => {
    const response = await createApp(SESSION_AUTH, null).request(
      "http://localhost/social-posts",
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(listWorkspaceSocialPostsMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown status", async () => {
    const response = await createApp().request(
      "http://localhost/social-posts?status=LIVE",
    );

    expect(response.status).toBe(422);
    expect(listWorkspaceSocialPostsMock).not.toHaveBeenCalled();
  });
});
