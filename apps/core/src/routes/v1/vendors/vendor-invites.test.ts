import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";

import mountRevokeVendorInvite from "./[id]/invites/[inviteId]/delete";
import mountListVendorInvites from "./[id]/invites/get";
import mountCreateVendorInvite from "./[id]/invites/post";
import mountAcceptVendorInvite from "./invites/[inviteId]/accept/post";
import mountDeclineVendorInvite from "./invites/[inviteId]/decline/post";
import mountListMyVendorInvites from "./invites/get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const db = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  vendorMemberFindUniqueMock: vi.fn(),
  vendorMemberCreateMock: vi.fn(),
  inviteFindFirstMock: vi.fn(),
  inviteFindUniqueMock: vi.fn(),
  inviteFindManyMock: vi.fn(),
  inviteCreateMock: vi.fn(),
  inviteUpdateMock: vi.fn(),
  inviteUpdateManyMock: vi.fn(),
  inviteCountMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    vendor: { findUnique: db.vendorFindUniqueMock },
    vendorMember: {
      findFirst: db.vendorMemberFindFirstMock,
      findUnique: db.vendorMemberFindUniqueMock,
      create: db.vendorMemberCreateMock,
    },
    vendorMemberInvite: {
      findFirst: db.inviteFindFirstMock,
      findUnique: db.inviteFindUniqueMock,
      findMany: db.inviteFindManyMock,
      create: db.inviteCreateMock,
      update: db.inviteUpdateMock,
      updateMany: db.inviteUpdateManyMock,
      count: db.inviteCountMock,
    },
    user: {
      findUnique: db.userFindUniqueMock,
      findFirst: db.userFindFirstMock,
    },
    $transaction: db.transactionMock,
  };
  return { default: client };
});

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_vendor_invites_test");
    c.set("isAuthenticated", authContext != null);
    c.set("authContext", authContext);
    await next();
  });
  app.onError(errorHandler);
  mountCreateVendorInvite(app);
  mountListVendorInvites(app);
  mountRevokeVendorInvite(app);
  mountListMyVendorInvites(app);
  mountAcceptVendorInvite(app);
  mountDeclineVendorInvite(app);
  return app;
}

const adminAuth = {
  actor: "user" as const,
  userId: "admin_user",
  organizationId: null,
  role: "user",
};

const inviteeAuth = {
  actor: "user" as const,
  userId: "invitee_user",
  organizationId: null,
  role: "user",
};

const pendingInvite = {
  id: "inv_1",
  vendorId: testVendor.id,
  email: "dev@example.com",
  role: "developer" as const,
  status: "PENDING" as const,
  expiresAt: new Date("2999-01-08T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function mockVendorAdmin() {
  db.vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
  db.vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_admin" });
}

describe("vendor member invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // requireVendorAdminMembership passes by default.
    mockVendorAdmin();
    db.userFindFirstMock.mockResolvedValue(null);
    db.vendorMemberFindUniqueMock.mockResolvedValue(null);
    db.inviteFindFirstMock.mockResolvedValue(null);
    db.inviteUpdateManyMock.mockResolvedValue({ count: 1 });
    db.inviteCountMock.mockResolvedValue(0);
    db.inviteCreateMock.mockResolvedValue(pendingInvite);
    db.inviteUpdateMock.mockResolvedValue({
      ...pendingInvite,
      status: "ACCEPTED",
    });
    // The tx double shares the same spies as the top-level client.
    db.transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          vendor: { findUnique: db.vendorFindUniqueMock },
          vendorMember: {
            findFirst: db.vendorMemberFindFirstMock,
            findUnique: db.vendorMemberFindUniqueMock,
            create: db.vendorMemberCreateMock,
          },
          vendorMemberInvite: {
            findFirst: db.inviteFindFirstMock,
            findUnique: db.inviteFindUniqueMock,
            create: db.inviteCreateMock,
            update: db.inviteUpdateMock,
            updateMany: db.inviteUpdateManyMock,
            count: db.inviteCountMock,
          },
          user: {
            findUnique: db.userFindUniqueMock,
            findFirst: db.userFindFirstMock,
          },
        }),
    );
  });

  it("invites an unregistered email without revealing that it is unregistered", async () => {
    db.userFindFirstMock.mockResolvedValue(null); // no such account

    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "Dev@Example.com" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    // Email is normalized (trim + lowercase) before storage.
    expect(db.inviteCreateMock).toHaveBeenCalledWith({
      data: {
        vendorId: testVendor.id,
        email: "dev@example.com",
        role: "developer",
        expiresAt: expect.any(Date),
        invitedById: "admin_user",
      },
    });
    // Response carries only the email + invite metadata: no user id or name.
    expect(body.data).toEqual({
      id: "inv_1",
      vendorId: testVendor.id,
      email: "dev@example.com",
      role: "developer",
      status: "PENDING",
      expiresAt: pendingInvite.expiresAt.toISOString(),
      createdAt: pendingInvite.createdAt.toISOString(),
    });
    expect(JSON.stringify(body)).not.toContain("invitee_user");
  });

  it("409s when the email already belongs to a member of this vendor", async () => {
    db.userFindFirstMock.mockResolvedValue({ id: "member_user" });
    db.vendorMemberFindUniqueMock.mockResolvedValue({ id: "vm_existing" });

    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );

    expect(response.status).toBe(409);
    expect(db.inviteCreateMock).not.toHaveBeenCalled();
  });

  it("returns the existing pending invite idempotently", async () => {
    db.inviteFindFirstMock.mockResolvedValue(pendingInvite);

    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );

    expect(response.status).toBe(201);
    expect(db.inviteCreateMock).not.toHaveBeenCalled();
  });

  it("429s when the vendor is at the pending invite cap", async () => {
    db.inviteCountMock.mockResolvedValue(100);

    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );

    expect(response.status).toBe(429);
    expect(db.inviteCreateMock).not.toHaveBeenCalled();
  });

  it("rejects invite create from a non-admin", async () => {
    db.vendorMemberFindFirstMock.mockResolvedValue(null); // not an admin

    const app = createApp(inviteeAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );

    expect(response.status).toBe(403);
    expect(db.inviteCreateMock).not.toHaveBeenCalled();
  });

  it("accepts an invitation addressed to the caller's email and creates the membership", async () => {
    db.userFindUniqueMock.mockResolvedValue({ email: "dev@example.com" });
    db.inviteFindUniqueMock.mockResolvedValue({
      ...pendingInvite,
      vendor: {
        ...testVendor,
        logoLight: null,
        logoDark: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    db.vendorMemberFindUniqueMock.mockResolvedValue(null);

    const app = createApp(inviteeAuth);
    const response = await app.request(
      "http://localhost/invites/inv_1/accept",
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(db.vendorMemberCreateMock).toHaveBeenCalledWith({
      data: {
        vendorId: testVendor.id,
        userId: "invitee_user",
        role: "developer",
      },
    });
    expect(db.inviteUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: {
        status: "ACCEPTED",
        acceptedByUserId: "invitee_user",
        resolvedAt: expect.any(Date),
      },
    });
    expect(body.data.role).toBe("developer");
    expect(body.data.slug).toBe(testVendor.slug);
  });

  it("404s accept when the invitation email is not the caller's", async () => {
    db.userFindUniqueMock.mockResolvedValue({ email: "other@example.com" });
    db.inviteFindUniqueMock.mockResolvedValue({
      ...pendingInvite,
      vendor: { ...testVendor },
    });

    const app = createApp(inviteeAuth);
    const response = await app.request(
      "http://localhost/invites/inv_1/accept",
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(db.vendorMemberCreateMock).not.toHaveBeenCalled();
  });

  it("lists the caller's pending invitations with vendor info", async () => {
    db.userFindUniqueMock.mockResolvedValue({ email: "dev@example.com" });
    db.inviteFindManyMock.mockResolvedValue([
      {
        ...pendingInvite,
        vendor: {
          ...testVendor,
          logoLight: null,
          logoDark: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    ]);

    const app = createApp(inviteeAuth);
    const response = await app.request("http://localhost/invites");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].vendor.slug).toBe(testVendor.slug);
    expect(body.data[0].role).toBe("developer");
  });

  it("revokes a pending invitation as a vendor admin", async () => {
    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites/inv_1`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(db.inviteUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "inv_1", vendorId: testVendor.id, status: "PENDING" },
      data: { status: "REVOKED", resolvedAt: expect.any(Date) },
    });
  });

  it("404s revoke when no pending invitation matches", async () => {
    db.inviteUpdateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(adminAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/invites/inv_1`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
  });

  it("declines an invitation addressed to the caller", async () => {
    db.userFindUniqueMock.mockResolvedValue({ email: "dev@example.com" });

    const app = createApp(inviteeAuth);
    const response = await app.request(
      "http://localhost/invites/inv_1/decline",
      { method: "POST" },
    );

    expect(response.status).toBe(204);
    expect(db.inviteUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "inv_1",
        email: "dev@example.com",
        status: "PENDING",
        expiresAt: { gt: expect.any(Date) },
      },
      data: { status: "DECLINED", resolvedAt: expect.any(Date) },
    });
  });
});
