import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  listPendingInvitationsMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  listPendingInvitationsMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@/helpers/invitation", () => ({
  listPendingInvitationsByOrganizationId: (...args: unknown[]) =>
    listPendingInvitationsMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

let mountGetOrganizationInvitations: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetOrganizationInvitations(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123", slug: "acme" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganizationInvitations = module.default;
});

describe("GET /organizations/{id}/invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await createApp(null).request(
      "http://localhost/org_123/invitations",
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_123/invitations",
    );
    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await createApp().request(
      "http://localhost/missing/invitations",
    );
    expect(response.status).toBe(404);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
    expect(listPendingInvitationsMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is a plain member (not owner/admin)", async () => {
    setMembership("member");
    const response = await createApp().request(
      "http://localhost/org_123/invitations",
    );
    expect(response.status).toBe(403);
    expect(listPendingInvitationsMock).not.toHaveBeenCalled();
  });

  it("returns the de-duplicated pending invitations for an owner", async () => {
    setMembership("owner");
    listPendingInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_123",
        email: "jane@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        inviterId: "user_123",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const response = await createApp().request(
      "http://localhost/org_123/invitations",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listPendingInvitationsMock).toHaveBeenCalledWith("org_123");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "inv_1",
      email: "jane@example.com",
    });
  });
});
