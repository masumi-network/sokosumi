import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";
import mountDeleteCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/[userId]/delete";
import mountListCoworkerAssignments from "./[id]/coworkers/[coworkerId]/assignments/get";
import mountPutCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/put";
import mountRemoveVendorMember from "./[id]/members/[userId]/delete";
import mountPatchVendorMemberRole from "./[id]/members/[userId]/patch";
import mountListVendorMembers from "./[id]/members/get";
import mountPatchVendor from "./[id]/patch";
import mountListMyVendorMemberships from "./me/get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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
  txVendorMemberFindFirstMock,
  txVendorMemberCountMock,
  txVendorMemberFindUniqueMock,
  txVendorMemberUpdateMock,
  txVendorMemberDeleteMock,
  txCoworkerAssignmentDeleteManyMock,
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
  txVendorMemberFindFirstMock: vi.fn(),
  txVendorMemberCountMock: vi.fn(),
  txVendorMemberFindUniqueMock: vi.fn(),
  txVendorMemberUpdateMock: vi.fn(),
  txVendorMemberDeleteMock: vi.fn(),
  txCoworkerAssignmentDeleteManyMock: vi.fn(),
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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_vendor_admin_test");
    c.set("isAuthenticated", authContext != null);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountListMyVendorMemberships(app);
  mountPatchVendor(app);
  mountListVendorMembers(app);
  mountPatchVendorMemberRole(app);
  mountRemoveVendorMember(app);
  mountListCoworkerAssignments(app);
  mountPutCoworkerAssignment(app);
  mountDeleteCoworkerAssignment(app);

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
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_123" });
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    userFindFirstMock.mockResolvedValue({ id: "dev_user" });
    txVendorMemberFindFirstMock.mockResolvedValue(null);
    txVendorMemberCountMock.mockResolvedValue(2);
    txVendorMemberFindUniqueMock.mockResolvedValue(null);
    txVendorMemberUpdateMock.mockResolvedValue({
      role: "admin",
      user: {
        id: "dev_user",
        email: "dev@example.com",
        name: "Dev User",
      },
    });
    txVendorMemberDeleteMock.mockResolvedValue({ id: "vm_dev" });
    txCoworkerAssignmentDeleteManyMock.mockResolvedValue({ count: 1 });
    // The tx double uses its own spies so a write that slips back onto the
    // top-level client fails the SOK-1024 assertions below.
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          coworkerAssignment: {
            deleteMany: txCoworkerAssignmentDeleteManyMock,
          },
          vendorMember: {
            findFirst: txVendorMemberFindFirstMock,
            count: txVendorMemberCountMock,
            findUnique: txVendorMemberFindUniqueMock,
            update: txVendorMemberUpdateMock,
            delete: txVendorMemberDeleteMock,
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

  it("patches vendor member role by user id", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    txVendorMemberFindUniqueMock.mockResolvedValue({ role: "developer" });

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
    expect(txVendorMemberUpdateMock).toHaveBeenCalledWith({
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
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    txVendorMemberFindUniqueMock.mockResolvedValue({ role: "admin" });
    txVendorMemberFindFirstMock.mockResolvedValue({ role: "admin" });
    txVendorMemberCountMock.mockResolvedValue(2);
    txVendorMemberUpdateMock.mockResolvedValue({
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
    // SOK-1024: the last-admin check and the write share one Serializable
    // transaction, so a concurrent demote/remove cannot both pass the guard.
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(txVendorMemberCountMock).toHaveBeenCalled();
    expect(vendorMemberCountMock).not.toHaveBeenCalled();
    expect(txVendorMemberUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "developer" },
      }),
    );
    expect(vendorMemberUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when patching a member the vendor does not have", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "stranger" });
    txVendorMemberFindUniqueMock.mockResolvedValue(null);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/stranger`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "developer" }),
      },
    );

    expect(response.status).toBe(404);
    expect(txVendorMemberUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the role patch keeps losing the serialization race", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );
    vi.useFakeTimers();
    try {
      const app = createApp(userAuth);
      const pending = app.request(
        `http://localhost/${testVendor.id}/members/other_admin`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "developer" }),
        },
      );
      await vi.runAllTimersAsync();
      const response = await pending;

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "concurrency_conflict",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks demoting the last admin inside the transaction", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    txVendorMemberFindUniqueMock.mockResolvedValue({ role: "admin" });
    txVendorMemberFindFirstMock.mockResolvedValue({ role: "admin" });
    txVendorMemberCountMock.mockResolvedValue(1);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/other_admin`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "developer" }),
      },
    );

    expect(response.status).toBe(400);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(txVendorMemberUpdateMock).not.toHaveBeenCalled();
  });

  it("removes a vendor member and clears coworker assignments", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "dev_user" });
    txVendorMemberFindFirstMock.mockResolvedValue({ role: "developer" });

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/dev_user`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(txCoworkerAssignmentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: "dev_user",
        coworker: { vendorId: testVendor.id },
      },
    });
    expect(txVendorMemberDeleteMock).toHaveBeenCalledWith({
      where: {
        vendorId_userId: {
          vendorId: testVendor.id,
          userId: "dev_user",
        },
      },
    });
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(coworkerAssignmentDeleteManyMock).not.toHaveBeenCalled();
    expect(vendorMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 404 when removing a member the vendor does not have", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "stranger" });
    txVendorMemberFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/stranger`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(txCoworkerAssignmentDeleteManyMock).not.toHaveBeenCalled();
    expect(txVendorMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the removal keeps losing the serialization race", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );
    vi.useFakeTimers();
    try {
      const app = createApp(userAuth);
      const pending = app.request(
        `http://localhost/${testVendor.id}/members/other_admin`,
        { method: "DELETE" },
      );
      await vi.runAllTimersAsync();
      const response = await pending;

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "concurrency_conflict",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks removing the last admin inside the transaction", async () => {
    mockVendorAdmin();
    userFindUniqueMock.mockResolvedValue({ id: "other_admin" });
    txVendorMemberFindFirstMock.mockResolvedValue({ role: "admin" });
    txVendorMemberCountMock.mockResolvedValue(1);

    const app = createApp(userAuth);
    const response = await app.request(
      `http://localhost/${testVendor.id}/members/other_admin`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(txCoworkerAssignmentDeleteManyMock).not.toHaveBeenCalled();
    expect(txVendorMemberDeleteMock).not.toHaveBeenCalled();
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
