import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountRecycle from "./social-account-posts/[accountPostId]/recycle/post";

const mocks = vi.hoisted(() => ({
  recycle: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/social-posts.service", () => ({
  recycleSocialAccountPost: mocks.recycle,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: mocks.delegation,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: mocks.capability,
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const accountPostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const auth: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const workspace: WorkspaceContext = {
  workspaceId,
  userId: "owner",
  organizationId: null,
};

const recycled = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId,
  provider: "x",
  text: "Winner on the feed",
  firstComment: null,
  media: [],
  status: "DRAFT",
  scheduledAt: null,
  timezone: null,
  socialConnection: {
    id: "33333333-3333-4333-8333-333333333333",
    externalHandle: "sokosumi",
    displayName: "Sokosumi",
    avatarUrl: null,
    subscriptionType: null,
    status: "active",
  },
  creator: { kind: "user", id: "owner", name: "Ada" },
  scheduledByUserId: null,
  scheduledByCoworkerId: null,
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
  createdAt: new Date("2026-10-11T12:00:00Z"),
  updatedAt: new Date("2026-10-11T12:00:00Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: true,
  canPublishNow: true,
  canDuplicate: false,
  canApprove: false,
  canReject: false,
  connectionNeedsReconnect: false,
};

function createApp() {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    c.set("workspaceContext", workspace);
    await next();
  });
  mountRecycle(app);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
  mocks.recycle.mockResolvedValue(recycled);
});

describe("recycle social account post route", () => {
  it("recycles a Performance post as a draft", async () => {
    const response = await createApp().request(
      `/${projectId}/social-account-posts/${accountPostId}/recycle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(201);
    expect(mocks.recycle).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        workspaceId,
        accountPostId,
        userId: "owner",
      }),
    );
  });

  it("rejects a delay without a time zone", async () => {
    const response = await createApp().request(
      `/${projectId}/social-account-posts/${accountPostId}/recycle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delayDays: 7 }),
      },
    );
    expect(response.status).toBe(422);
    expect(mocks.recycle).not.toHaveBeenCalled();
  });
});
