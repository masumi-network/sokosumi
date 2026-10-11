import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, unauthorized } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountQueueSocialPost from "./social-posts/[postId]/queue/post.js";
import mountListSocialQueueSlots from "./social-queue-slots/get.js";
import mountReplaceSocialQueueSlots from "./social-queue-slots/put.js";

const {
  requireAuthorizedUserContextMock,
  requireCoworkerCapabilityMock,
  listSocialQueueSlotsMock,
  queueSocialPostMock,
  replaceSocialQueueSlotsMock,
  requireSocialBetaAccessMock,
} = vi.hoisted(() => ({
  requireAuthorizedUserContextMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
  listSocialQueueSlotsMock: vi.fn(),
  queueSocialPostMock: vi.fn(),
  replaceSocialQueueSlotsMock: vi.fn(),
  requireSocialBetaAccessMock: vi.fn(),
}));

vi.mock("@/services/social-queue.service", () => ({
  listSocialQueueSlots: listSocialQueueSlotsMock,
  queueSocialPost: queueSocialPostMock,
  replaceSocialQueueSlots: replaceSocialQueueSlotsMock,
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

const WORKSPACE_CONTEXT: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
};

const slots = {
  timezone: "UTC",
  slots: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Tuesday morning",
      weekday: 2,
      minutesFromMidnight: 660,
      timezone: "UTC",
    },
  ],
};

const queuedPost = {
  id: POST_ID,
  projectId: PROJECT_ID,
  provider: "x",
  text: "Hello world",
  media: [],
  status: "SCHEDULED",
  scheduledAt: new Date(SCHEDULED_AT),
  timezone: "UTC",
  socialConnection: null,
  creator: { kind: "user", id: USER_ID, name: "Ada Lovelace" },
  scheduledByUserId: USER_ID,
  canceledAt: null,
  publishedAt: null,
  publishedExternalId: null,
  publishedUrl: null,
  lastError: null,
  attemptCount: 0,
  nextAttemptAt: null,
  lastAttemptAt: null,
  lastAttempt: null,
  revision: 1,
  createdAt: new Date("2026-09-15T10:00:00.000Z"),
  updatedAt: new Date("2026-09-15T10:00:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: true,
  canPublishNow: true,
  connectionNeedsReconnect: false,
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

  mountListSocialQueueSlots(app);
  mountReplaceSocialQueueSlots(app);
  mountQueueSocialPost(app);

  return app;
}

function json(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("Project social queue routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthorizedUserContextMock.mockRejectedValue(
      forbidden("Coworker delegation required"),
    );
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    requireSocialBetaAccessMock.mockResolvedValue(undefined);
    listSocialQueueSlotsMock.mockResolvedValue(slots);
    replaceSocialQueueSlotsMock.mockResolvedValue(slots);
    queueSocialPostMock.mockResolvedValue(queuedPost);
  });

  it("lists posting-queue slots", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-queue-slots`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: slots });
    expect(listSocialQueueSlotsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("replaces posting-queue slots", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-queue-slots`,
      json("PUT", {
        timezone: "UTC",
        slots: [
          { name: "Tuesday morning", weekday: 2, minutesFromMidnight: 660 },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(replaceSocialQueueSlotsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      timezone: "UTC",
      slots: [
        { name: "Tuesday morning", weekday: 2, minutesFromMidnight: 660 },
      ],
    });
  });

  it("rejects a duplicate weekday and time", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-queue-slots`,
      json("PUT", {
        timezone: "UTC",
        slots: [
          { name: "Morning", weekday: 2, minutesFromMidnight: 660 },
          { name: "Also morning", weekday: 2, minutesFromMidnight: 660 },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect(replaceSocialQueueSlotsMock).not.toHaveBeenCalled();
  });

  it("queues a draft in the next free slot", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-posts/${POST_ID}/queue`,
      json("POST", { revision: 0 }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: POST_ID, status: "SCHEDULED", scheduledAt: SCHEDULED_AT },
    });
    expect(queueSocialPostMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      coworkerId: undefined,
      postId: POST_ID,
      socialConnectionId: undefined,
      revision: 0,
    });
  });

  it("rejects queueing without authentication", async () => {
    const response = await createApp(null).request(
      `http://localhost/${PROJECT_ID}/social-queue-slots`,
    );

    expect(response.status).toBe(401);
    expect(listSocialQueueSlotsMock).not.toHaveBeenCalled();
  });
});
