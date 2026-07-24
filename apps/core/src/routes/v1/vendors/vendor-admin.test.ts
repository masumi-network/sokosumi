import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";
import mountDeleteCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/[userId]/delete";
import mountListCoworkerAssignments from "./[id]/coworkers/[coworkerId]/assignments/get";
import mountPutCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/put";
import mountRemoveVendorMember from "./[id]/members/[userId]/delete";
import mountPatchVendorMemberRole from "./[id]/members/[userId]/patch";
import mountListVendorMembers from "./[id]/members/get";
import mountAddVendorMember from "./[id]/members/post";
import mountPatchVendor from "./[id]/patch";
import mountListMyVendorMemberships from "./me/get";

const {
  vendorFindUniqueMock,
  vendorUpdateMock,
  vendorMemberFindManyMock,
  vendorMemberFindFirstMock,
  vendorMemberFindUniqueMock,
  vendorMemberCreateMock,
  vendorMemberUpdateMock,
  vendorMemberCountMock,
  vendorMemberDeleteMock,
  coworkerFindFirstMock,
  coworkerAssignmentUpsertMock,
  coworkerAssignmentFindManyMock,
  coworkerAssignmentDeleteManyMock,
  userFindUniqueMock,
  userFindFirstMock,
  transactionMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorUpdateMock: vi.fn(),
  vendorMemberFindManyMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  vendorMemberFindUniqueMock: vi.fn(),
  vendorMemberCreateMock: vi.fn(),
  vendorMemberUpdateMock: vi.fn(),
  vendorMemberCountMock: vi.fn(),
  vendorMemberDeleteMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  coworkerAssignmentUpsertMock: vi.fn(),
  coworkerAssignmentFindManyMock: vi.fn(),
  coworkerAssignmentDeleteManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      findUnique: vendorFindUniqueMock,
      update: vendorUpdateMock,
    },
    vendorMember: {
      findMany: vendorMemberFindManyMock,
      findFirst: vendorMemberFindFirstMock,
      findUnique: vendorMemberFindUniqueMock,
      create: vendorMemberCreateMock,
      update: vendorMemberUpdateMock,
      count: vendorMemberCountMock,
      delete: vendorMemberDeleteMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    coworkerAssignment: {
      upsert: coworkerAssignmentUpsertMock,
      findMany: coworkerAssignmentFindManyMock,
      deleteMany: coworkerAssignmentDeleteManyMock,
    },
    user: {
      findUnique: userFindUniqueMock,
      findFirst: userFindFirstMock,
    },
    $transaction: transactionMock,
  },
}));

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_vendor_admin_test");
    c.set("isAuthenticated", authContext != null);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountListMyVendorMemberships(app as unknown as OpenAPIHonoWithAuth);
  mountPatchVendor(app as unknown as OpenAPIHonoWithAuth);
  mountListVendorMembers(app as unknown as OpenAPIHonoWithAuth);
  mountAddVendorMember(app as unknown as OpenAPIHonoWithAuth);
  mountPatchVendorMemberRole(app as unknown as OpenAPIHonoWithAuth);
  mountRemoveVendorMember(app as unknown as OpenAPIHonoWithAuth);
  mountListCoworkerAssignments(app as unknown as OpenAPIHonoWithAuth);
  mountPutCoworkerAssignment(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerAssignment(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const userAuth = {
  actor: "user" as const,
  userId: "admin_user",
  organizationId: null,
  role: "user",
};

const developerAuth = {
  actor: "user" as const,
  userId: "dev_user",
  organizationId: null,
  role: "user",
};

function mockVendorAdmin() {
  vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
  vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_admin" });
}

function mockVendorDeveloperTarget() {
  vendorMemberFindFirstMock
    .mockResolvedValueOnce({ id: "vm_admin" })
    .mockResolvedValueOnce({ id: "vm_dev" });
}

describe("vendor admin APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
    vendorMemberFindFirstMock.mockResolvedValue(null);
    vendorMemberFindUniqueMock.mockResolvedValue(null);
    vendorMemberCountMock.mockResolvedValue(2);
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_123" });
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    userFindFirstMock.mockResolvedValue({ id: "dev_user" });
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          coworkerAssignment: {
            deleteMany: coworkerAssignmentDeleteManyMock,
          },
          vendorMember: {
            delete: vendorMemberDeleteMock,
          },
        }),
    );
    vendorMemberFindManyMock.mockResolvedValue([
      {
        role: "developer",
        user: {
          id: "dev_user",
          email: "dev@example.com",
          name: "Dev User",
        },
      },
    ]);
    vendorMemberCreateMock.mockResolvedValue({
      role: "developer",
      user: {
        id: "dev_user",
        email: "dev@example.com",
        name: "Dev User",
      },
    });
    vendorMemberUpdateMock.mockResolvedValue({
      role: "admin",
      user: {
        id: "dev_user",
        email: "dev@example.com",
        name: "Dev User",
      },
    });
    vendorUpdateMock.mockResolvedValue({
      ...testVendor,
      name: "Updated Vendor",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    coworkerAssignmentUpsertMock.mockResolvedValue({
      coworkerId: "cow_123",
      userId: "dev_user",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    coworkerAssignmentFindManyMock.mockResolvedValue([
      {
        coworkerId: "cow_123",
        userId: "dev_user",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    coworkerAssignmentDeleteManyMock.mockResolvedValue({ count: 1 });
    vendorMemberDeleteMock.mockResolvedValue({ id: "vm_dev" });
  });

  it("lists vendor memberships for the authenticated user", async () => {
    vendorMemberFindManyMock.mockResolvedValue([
      {
        role: "admin",
        vendor: {
          ...testVendor,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    ]);

    const app = createApp(userAuth);
    const response = await app.request("http://localhost/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vendorMemberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "admin_user" },
      include: { vendor: true },
      orderBy: [{ vendor: { name: "asc" } }, { vendor: { slug: "asc" } }],
    });
    expect(body.data[0].role).toBe("admin");
    expect(body.data[0].slug).toBe(testVendor.slug);
  });

  it("patches vendor name and logos for vendor admins without clearing omitted logo side", async () => {
    mockVendorAdmin();

    const app = createApp(userAuth);
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated Vendor",
        logos: { light: "https://example.com/new-light.png" },
      }),
    });

    expect(response.status).toBe(200);
    expect(vendorUpdateMock).toHaveBeenCalledWith({
      where: { id: testVendor.id },
      data: {
        name: "Updated Vendor",
        logoLight: "https://example.com/new-light.png",
      },
    });
  });

  it("rejects vendor profile patch for non-admin members", async () => {
    const app = createApp(developerAuth);
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(403);
    expect(vendorUpdateMock).not.toHaveBeenCalled();
  });

  it("lists vendor members for vendor admins", async () => {
    mockVendorAdmin();

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toEqual({
      id: "dev_user",
      email: "dev@example.com",
      name: "Dev User",
      role: "developer",
    });
  });

  it("adds a vendor member by email and defaults role to developer", async () => {
    mockVendorAdmin();
    userFindFirstMock.mockResolvedValue({ id: "dev_user" });
    vendorMemberFindUniqueMock.mockResolvedValue(null);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dev@example.com",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(vendorMemberCreateMock).toHaveBeenCalledWith({
      data: {
        vendorId: testVendor.id,
        userId: "dev_user",
        role: "developer",
      },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });
    expect(body.data.role).toBe("developer");
  });

  it("adds a vendor member as admin when role is provided", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "admin_user" });
    vendorMemberFindUniqueMock.mockResolvedValue(null);
    vendorMemberCreateMock.mockResolvedValue({
      role: "admin",
      user: {
        id: "admin_user",
        email: "admin@example.com",
        name: "Admin User",
      },
    });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "admin_user",
          role: "admin",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(vendorMemberCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin_user",
          role: "admin",
        }),
      }),
    );
    expect(body.data.role).toBe("admin");
  });

  it("rejects add when both userId and email are provided", async () => {
    mockVendorAdmin();

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "dev_user",
          email: "dev@example.com",
          role: "developer",
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(vendorMemberCreateMock).not.toHaveBeenCalled();
  });

  it("patches vendor member role by user id", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    vendorMemberFindUniqueMock.mockResolvedValue({ role: "developer" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/dev_user`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(response.status).toBe(200);
    expect(vendorMemberUpdateMock).toHaveBeenCalledWith({
      where: {
        vendorId_userId: {
          vendorId: testVendor.id,
          userId: "dev_user",
        },
      },
      data: { role: "admin" },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });
  });

  it("demotes an admin to developer when another admin remains", async () => {
    vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    vendorMemberFindUniqueMock.mockResolvedValue({ role: "admin" });
    vendorMemberFindFirstMock
      .mockResolvedValueOnce({ id: "vm_admin" })
      .mockResolvedValueOnce({ role: "admin" });
    vendorMemberCountMock.mockResolvedValue(2);
    vendorMemberUpdateMock.mockResolvedValue({
      role: "developer",
      user: {
        id: "other_admin",
        email: "other@example.com",
        name: "Other Admin",
      },
    });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/other_admin`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "developer" }),
      },
    );

    expect(response.status).toBe(200);
    expect(vendorMemberCountMock).toHaveBeenCalled();
    expect(vendorMemberUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "developer" },
      }),
    );
  });

  it("removes a vendor member and clears coworker assignments", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    vendorMemberFindFirstMock
      .mockResolvedValueOnce({ id: "vm_admin" })
      .mockResolvedValueOnce({ role: "developer" });
    vendorMemberFindUniqueMock.mockResolvedValue({ id: "vm_dev" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/dev_user`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(coworkerAssignmentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: "dev_user",
        coworker: { vendorId: testVendor.id },
      },
    });
    expect(vendorMemberDeleteMock).toHaveBeenCalledWith({
      where: {
        vendorId_userId: {
          vendorId: testVendor.id,
          userId: "dev_user",
        },
      },
    });
  });

  it("assigns a developer member to a vendor coworker", async () => {
    mockVendorDeveloperTarget();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "dev_user" }),
      },
    );

    expect(response.status).toBe(201);
    expect(coworkerAssignmentUpsertMock).toHaveBeenCalledWith({
      where: {
        coworkerId_userId: {
          coworkerId: "cow_123",
          userId: "dev_user",
        },
      },
      create: {
        coworkerId: "cow_123",
        userId: "dev_user",
      },
      update: {},
    });
  });

  it("assigns a vendor member to a coworker by email", async () => {
    mockVendorDeveloperTarget();
    userFindFirstMock.mockResolvedValue({ id: "dev_user" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );

    expect(response.status).toBe(201);
    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { email: { equals: "dev@example.com", mode: "insensitive" } },
      select: { id: true },
    });
  });

  it("assigns a vendor admin member to a coworker", async () => {
    mockVendorDeveloperTarget();
    userFindUniqueMock.mockResolvedValue({ id: "admin_user" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "admin_user" }),
      },
    );

    expect(response.status).toBe(201);
    expect(coworkerAssignmentUpsertMock).toHaveBeenCalledWith({
      where: {
        coworkerId_userId: {
          coworkerId: "cow_123",
          userId: "admin_user",
        },
      },
      create: {
        coworkerId: "cow_123",
        userId: "admin_user",
      },
      update: {},
    });
  });

  it("rejects assignment when target user is not a vendor member", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "outsider" });
    vendorMemberFindFirstMock
      .mockResolvedValueOnce({ id: "vm_admin" })
      .mockResolvedValueOnce(null);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "outsider" }),
      },
    );

    expect(response.status).toBe(400);
    expect(coworkerAssignmentUpsertMock).not.toHaveBeenCalled();
  });

  it("lists coworker assignments for vendor admins", async () => {
    mockVendorAdmin();

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments`,
    );

    expect(response.status).toBe(200);
    expect(coworkerAssignmentFindManyMock).toHaveBeenCalledWith({
      where: { coworkerId: "cow_123" },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    });
  });

  it("unassigns a developer from a coworker idempotently", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments/dev_user`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(coworkerAssignmentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        coworkerId: "cow_123",
        userId: "dev_user",
      },
    });
  });

  it("unassigns a developer by email path", async () => {
    mockVendorAdmin();
    userFindFirstMock.mockResolvedValue({ id: "dev_user" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/coworkers/cow_123/assignments/${encodeURIComponent("dev@example.com")}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(coworkerAssignmentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        coworkerId: "cow_123",
        userId: "dev_user",
      },
    });
  });
});
