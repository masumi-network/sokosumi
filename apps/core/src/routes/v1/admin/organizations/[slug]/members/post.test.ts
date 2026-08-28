import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountAddAdminOrganizationMember from "./post";

const {
  getAdminOrganizationBySlugMock,
  getUserByIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  createMemberMock,
  getMembersWithUserAndLastSeenMock,
  ensurePersonalWorkspaceForOrganizationMembershipMock,
  upgradeGuestChatRoomMembershipsToMemberMock,
  resolveActiveSubscriptionByReferenceIdMock,
  getLatestSubscriptionByReferenceIdMock,
  transactionMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  getAdminOrganizationBySlugMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  createMemberMock: vi.fn(),
  getMembersWithUserAndLastSeenMock: vi.fn(),
  ensurePersonalWorkspaceForOrganizationMembershipMock: vi.fn(),
  upgradeGuestChatRoomMembershipsToMemberMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getLatestSubscriptionByReferenceIdMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
  },
}));

vi.mock("@/helpers/admin-organization-overview.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/admin-organization-overview.js")
    >();
  return {
    ...actual,
    getAdminOrganizationBySlug: (...args: unknown[]) =>
      getAdminOrganizationBySlugMock(...args),
  };
});

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
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
    getLatestSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@/helpers/org-membership-personal-workspace", () => ({
  ensurePersonalWorkspaceForOrganizationMembership: (...args: unknown[]) =>
    ensurePersonalWorkspaceForOrganizationMembershipMock(...args),
}));

vi.mock("@/helpers/chat-room-guest-upgrade", () => ({
  upgradeGuestChatRoomMembershipsToMember: (...args: unknown[]) =>
    upgradeGuestChatRoomMembershipsToMemberMock(...args),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountAddAdminOrganizationMember(app);

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
    ensurePersonalWorkspaceForOrganizationMembershipMock.mockResolvedValue(
      undefined,
    );
    upgradeGuestChatRoomMembershipsToMemberMock.mockResolvedValue(0);
    getMembersWithUserAndLastSeenMock.mockResolvedValue([MEMBER]);
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "starter",
      status: "active",
    });
    getLatestSubscriptionByReferenceIdMock.mockResolvedValue(null);
  });

  it("creates a personal workspace in the same transaction as membership", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    expect(
      ensurePersonalWorkspaceForOrganizationMembershipMock,
    ).toHaveBeenCalledWith("user_target", {
      tx: expect.anything(),
      organizationId: "org_1",
    });
    expect(createMemberMock).toHaveBeenCalled();
  });

  it("fails the add when personal workspace ensure fails", async () => {
    ensurePersonalWorkspaceForOrganizationMembershipMock.mockRejectedValue(
      new Error("personal workspace failed"),
    );

    const response = await post();

    expect(response.status).toBe(500);
    expect(createMemberMock).not.toHaveBeenCalled();
  });

  it("returns the member with org subscription and no credits field", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).not.toHaveProperty("credits");
    expect(body.data.subscriptionPlan).toBe("starter");
    expect(body.data.subscriptionStatus).toBe("active");
  });
});
