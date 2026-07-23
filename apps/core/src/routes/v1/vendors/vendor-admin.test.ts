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
import mountListVendorMembers from "./[id]/members/get";
import mountPatchVendor from "./[id]/patch";
import mountListMyVendorMemberships from "./me/get";

const {
  vendorFindUniqueMock,
  vendorUpdateMock,
  vendorMemberFindManyMock,
  vendorMemberFindFirstMock,
  coworkerFindFirstMock,
  coworkerAssignmentUpsertMock,
  coworkerAssignmentFindManyMock,
  coworkerAssignmentDeleteManyMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorUpdateMock: vi.fn(),
  vendorMemberFindManyMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  coworkerAssignmentUpsertMock: vi.fn(),
  coworkerAssignmentFindManyMock: vi.fn(),
  coworkerAssignmentDeleteManyMock: vi.fn(),
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
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    coworkerAssignment: {
      upsert: coworkerAssignmentUpsertMock,
      findMany: coworkerAssignmentFindManyMock,
      deleteMany: coworkerAssignmentDeleteManyMock,
    },
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
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_123" });
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

  it("assigns a developer member to a vendor coworker", async () => {
    mockVendorDeveloperTarget();

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

  it("rejects assignment when target user is not a developer member", async () => {
    mockVendorAdmin();
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
});
