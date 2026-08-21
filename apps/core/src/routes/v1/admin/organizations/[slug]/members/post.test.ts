import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountAddAdminOrganizationMember from "./post";

const {
  getAdminOrganizationBySlugMock,
  getUserByIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  createMemberMock,
  getMembersWithUserAndLastSeenMock,
  ensurePersonalWorkspaceKeepingPreferredMock,
  upgradeGuestChatRoomMembershipsToMemberMock,
  syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
  buildCreditsPayloadMock,
  transactionMock,
} = vi.hoisted(() => ({
  getAdminOrganizationBySlugMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  createMemberMock: vi.fn(),
  getMembersWithUserAndLastSeenMock: vi.fn(),
  ensurePersonalWorkspaceKeepingPreferredMock: vi.fn(),
  upgradeGuestChatRoomMembershipsToMemberMock: vi.fn(),
  syncLocalFreeSeatsAndCreditsForCurrentMembersMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
  },
}));

vi.mock("@/helpers/admin-organization-overview.js", () => ({
  getAdminOrganizationBySlug: (...args: unknown[]) =>
    getAdminOrganizationBySlugMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    createMember: (...args: unknown[]) => createMemberMock(...args),
    getMembersWithUserAndLastSeen: (...args: unknown[]) =>
      getMembersWithUserAndLastSeenMock(...args),
  },
  workspaceRepository: {
    ensurePersonalWorkspaceKeepingPreferred: (...args: unknown[]) =>
      ensurePersonalWorkspaceKeepingPreferredMock(...args),
  },
}));

vi.mock("@/helpers/chat-room-guest-upgrade", () => ({
  upgradeGuestChatRoomMembershipsToMember: (...args: unknown[]) =>
    upgradeGuestChatRoomMembershipsToMemberMock(...args),
}));

vi.mock("@/services/organization-subscription-auth.service", () => ({
  syncLocalFreeSeatsAndCreditsForCurrentMembers: (...args: unknown[]) =>
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock(...args),
}));

vi.mock("@/helpers/subscription.js", () => ({
  buildCreditsPayload: (...args: unknown[]) => buildCreditsPayloadMock(...args),
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_org_member_post_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    });
    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountAddAdminOrganizationMember(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const ORG = { id: "org_1", slug: "acme" };
const MEMBER = {
  id: "mem_1",
  organizationId: "org_1",
  role: "member",
  seatAssignedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  userId: "user_target",
  lastSeenAt: null,
  user: {
    id: "user_target",
    name: "Target",
    email: "target@example.com",
  },
};

async function post() {
  const app = createApp();
  return app.request("http://localhost/acme/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "user_target", role: "member" }),
  });
}

describe("POST /admin/organizations/{slug}/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) => callback({}));
    getAdminOrganizationBySlugMock.mockResolvedValue(ORG);
    getUserByIdMock.mockResolvedValue({ id: "user_target" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);
    createMemberMock.mockResolvedValue({ id: "mem_1" });
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: true,
      workspace: { id: "ws_1" },
    });
    upgradeGuestChatRoomMembershipsToMemberMock.mockResolvedValue(0);
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock.mockResolvedValue(
      undefined,
    );
    getMembersWithUserAndLastSeenMock.mockResolvedValue([MEMBER]);
    buildCreditsPayloadMock.mockResolvedValue({
      credits: { total: 0, subscription: null },
    });
  });

  it("creates a personal workspace in the same transaction as membership", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    expect(ensurePersonalWorkspaceKeepingPreferredMock).toHaveBeenCalledWith({
      userId: "user_target",
      tx: expect.anything(),
    });
    expect(createMemberMock).toHaveBeenCalled();
  });

  it("fails the add when personal workspace ensure fails", async () => {
    ensurePersonalWorkspaceKeepingPreferredMock.mockRejectedValue(
      new Error("personal workspace failed"),
    );

    const response = await post();

    expect(response.status).toBe(500);
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
    ).not.toHaveBeenCalled();
  });
});
