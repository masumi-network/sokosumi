import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAcceptInviteLink from "./post";

const {
  authContextState,
  getInviteLinkByTokenMock,
  tryConsumeInviteLinkMock,
  getMemberMock,
  createMemberMock,
  ensurePersonalWorkspaceForOrganizationMembershipMock,
  ensureGateMock,
  syncSeatsMock,
  orgFindUniqueMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    } as
      | {
          actor: "user";
          userId: string;
          organizationId: string | null;
          role: string;
        }
      | {
          actor: "coworker";
          coworkerId: string;
          vendorId?: string;
          context?: { userId: string; organizationId: string | null };
        }
      | null,
  },
  getInviteLinkByTokenMock: vi.fn(),
  tryConsumeInviteLinkMock: vi.fn(),
  getMemberMock: vi.fn(),
  createMemberMock: vi.fn(),
  ensurePersonalWorkspaceForOrganizationMembershipMock: vi.fn(),
  ensureGateMock: vi.fn(),
  syncSeatsMock: vi.fn(),
  orgFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        req: { path: string; method: string };
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json({ error: "Unauthorized", message: "Unauthorized" }, 401);
      }
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  organizationInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
    tryConsumeInviteLink: (...args: unknown[]) =>
      tryConsumeInviteLinkMock(...args),
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberMock(...args),
    createMember: (...args: unknown[]) => createMemberMock(...args),
  },
}));

vi.mock("@/helpers/org-membership-personal-workspace", () => ({
  ensurePersonalWorkspaceForOrganizationMembership: (...args: unknown[]) =>
    ensurePersonalWorkspaceForOrganizationMembershipMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (cb: (tx: unknown) => unknown) => cb({}),
    organization: {
      findUnique: (...args: unknown[]) => orgFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/services/organization-subscription-auth.service", () => ({
  ensureCanAcceptOrganizationInvitation: (...args: unknown[]) =>
    ensureGateMock(...args),
  syncLocalFreeSeatsAndCreditsForCurrentMembers: (...args: unknown[]) =>
    syncSeatsMock(...args),
}));

const { upgradeGuestChatRoomMembershipsToMemberMock } = vi.hoisted(() => ({
  upgradeGuestChatRoomMembershipsToMemberMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/helpers/chat-room-guest-upgrade", () => ({
  upgradeGuestChatRoomMembershipsToMember:
    upgradeGuestChatRoomMembershipsToMemberMock,
}));

const { cancelPendingOrganizationInvitationsForUserMock } = vi.hoisted(() => ({
  cancelPendingOrganizationInvitationsForUserMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/helpers/invitation", () => ({
  cancelPendingOrganizationInvitationsForUser: (...args: unknown[]) =>
    cancelPendingOrganizationInvitationsForUserMock(...args),
}));

const NOW = Date.now();

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link_1",
    token: "tok_live",
    organizationId: "org_1",
    role: "member",
    createdByUserId: "owner_1",
    createdAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountAcceptInviteLink(app);
  return app;
}

async function post(token = "tok_live") {
  const app = createApp();
  return app.request(`http://localhost/${token}/accept`, { method: "POST" });
}

describe("POST /organization-invite-links/{token}/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    };
    orgFindUniqueMock.mockResolvedValue({ slug: "acme" });
    ensureGateMock.mockResolvedValue(undefined);
    syncSeatsMock.mockResolvedValue(undefined);
    getMemberMock.mockResolvedValue(null);
    tryConsumeInviteLinkMock.mockResolvedValue(true);
    createMemberMock.mockResolvedValue(undefined);
    ensurePersonalWorkspaceForOrganizationMembershipMock.mockResolvedValue(
      undefined,
    );
    upgradeGuestChatRoomMembershipsToMemberMock.mockResolvedValue(0);
    cancelPendingOrganizationInvitationsForUserMock.mockResolvedValue(0);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    authContextState.current = null;
    const response = await post();
    expect(response.status).toBe(401);
    expect(getInviteLinkByTokenMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker/context actor so it cannot enroll arbitrary users", async () => {
    // A coworker key carrying X-Context-User-Id must not be able to join a
    // victim user to an org via a shared link.
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: "vendor_1",
      context: { userId: "victim_999", organizationId: null },
    };
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());

    const response = await post();
    expect(response.status).toBe(403);
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(tryConsumeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("maps the billing-gate rejection to 400, not 500", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    ensureGateMock.mockRejectedValue(
      new APIError("BAD_REQUEST", {
        message: "An active organization subscription is required.",
      }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(syncSeatsMock).not.toHaveBeenCalled();
  });

  it("joins a valid link, enforcing the seat gate then syncing seats", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("joined");
    expect(body.data.organizationSlug).toBe("acme");
    expect(body.data.organizationId).toBe("org_1");
    // Billing gate runs before any membership write.
    expect(ensureGateMock).toHaveBeenCalledWith("org_1");
    expect(
      ensurePersonalWorkspaceForOrganizationMembershipMock,
    ).toHaveBeenCalledWith("user_123", {
      tx: expect.anything(),
      organizationId: "org_1",
    });
    expect(createMemberMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      "member",
      expect.anything(),
    );
    expect(tryConsumeInviteLinkMock).toHaveBeenCalledTimes(1);
    expect(syncSeatsMock).toHaveBeenCalledWith("org_1");
    expect(upgradeGuestChatRoomMembershipsToMemberMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      expect.anything(),
    );
    expect(
      cancelPendingOrganizationInvitationsForUserMock,
    ).toHaveBeenCalledWith("user_123", "org_1", expect.anything());
  });

  it("fails the join when personal workspace ensure fails", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    ensurePersonalWorkspaceForOrganizationMembershipMock.mockRejectedValue(
      new Error("personal workspace failed"),
    );

    const response = await post();

    expect(response.status).toBe(500);
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(syncSeatsMock).not.toHaveBeenCalled();
  });

  it("does not consume a use or sync seats when already a member", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink({ maxUses: 5 }));
    getMemberMock.mockResolvedValue({ id: "mem_1" });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("already_member");
    expect(tryConsumeInviteLinkMock).not.toHaveBeenCalled();
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(syncSeatsMock).not.toHaveBeenCalled();
    expect(
      cancelPendingOrganizationInvitationsForUserMock,
    ).toHaveBeenCalledWith("user_123", "org_1", expect.anything());
  });

  it("treats a concurrent unique-violation as already_member", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    createMemberMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["userId", "organizationId"] },
    });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("already_member");
    // A rolled-back join must not sync seats.
    expect(syncSeatsMock).not.toHaveBeenCalled();
    expect(
      cancelPendingOrganizationInvitationsForUserMock,
    ).toHaveBeenCalledWith("user_123", "org_1", expect.anything());
  });

  it("does not map a personal-workspace unique violation to already_member", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    ensurePersonalWorkspaceForOrganizationMembershipMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["userId"] },
      }),
    );

    const response = await post();

    expect(response.status).toBe(500);
    expect(syncSeatsMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the link is depleted at consume time", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink({ maxUses: 1 }));
    tryConsumeInviteLinkMock.mockResolvedValue(false);

    const response = await post();
    expect(response.status).toBe(400);
    expect(createMemberMock).not.toHaveBeenCalled();
    expect(syncSeatsMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an expired link and never touches the gate", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ expiresAt: new Date(NOW - 1000) }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(ensureGateMock).not.toHaveBeenCalled();
    expect(createMemberMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a revoked link", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ revokedAt: new Date(NOW - 500) }),
    );

    const response = await post();
    expect(response.status).toBe(400);
    expect(createMemberMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown token", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(null);

    const response = await post("tok_missing");
    expect(response.status).toBe(404);
    expect(ensureGateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization no longer exists", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    orgFindUniqueMock.mockResolvedValue(null);

    const response = await post();
    expect(response.status).toBe(404);
    expect(ensureGateMock).not.toHaveBeenCalled();
  });
});
