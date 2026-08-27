import { MemberRole } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  resolveMemberOrganizationByIdMock,
  getInviteLinkByTokenMock,
  revokeInviteLinkMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  getInviteLinkByTokenMock: vi.fn(),
  revokeInviteLinkMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
    revokeInviteLink: (...args: unknown[]) => revokeInviteLinkMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "victim_999", organizationId: "org_123" },
};

const orgId = "org_123";
const otherOrgId = "org_other";
const token = "tok_live";
const NOW = new Date("2026-07-25T12:00:00.000Z");

let mountRevokeInviteLink: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountRevokeInviteLink(app);
  return app;
}

async function deleteRevoke(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
  pathOrgId = orgId,
  pathToken = token,
) {
  return createApp(authContext).request(
    `http://localhost/${pathOrgId}/invite-links/${pathToken}`,
    { method: "DELETE" },
  );
}

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link_1",
    token,
    organizationId: orgId,
    role: MemberRole.MEMBER,
    createdByUserId: "owner_1",
    createdAt: new Date(NOW.getTime() - 1000),
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  const module = await import("./delete");
  mountRevokeInviteLink = module.default;
});

describe("DELETE /organizations/{id}/invite-links/{token}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: orgId },
      role: MemberRole.OWNER,
    });
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    revokeInviteLinkMock.mockResolvedValue(liveLink({ revokedAt: NOW }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await deleteRevoke(null);
    expect(response.status).toBe(401);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker/context actor so it cannot revoke as a victim", async () => {
    const response = await deleteRevoke(COWORKER_AUTH_CONTEXT);
    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(getInviteLinkByTokenMock).not.toHaveBeenCalled();
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is a plain member (not owner/admin)", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await deleteRevoke();
    expect(response.status).toBe(403);
    expect(getInviteLinkByTokenMock).not.toHaveBeenCalled();
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: orgId,
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("revokes a live link scoped to the path organization", async () => {
    const response = await deleteRevoke();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ ok: true });
    expect(getInviteLinkByTokenMock).toHaveBeenCalledWith(
      token,
      expect.anything(),
    );
    expect(revokeInviteLinkMock).toHaveBeenCalledWith(
      "link_1",
      NOW,
      expect.anything(),
    );
  });

  it("returns 404 when the token belongs to a different organization", async () => {
    // Admin of org A must not revoke a link minted for org B by guessing token.
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ organizationId: otherOrgId }),
    );

    const response = await deleteRevoke();
    expect(response.status).toBe(404);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the token is unknown", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(null);

    const response = await deleteRevoke();
    expect(response.status).toBe(404);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the link is already revoked", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ revokedAt: new Date(NOW.getTime() - 60_000) }),
    );

    const response = await deleteRevoke();
    expect(response.status).toBe(200);
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
  });
});
