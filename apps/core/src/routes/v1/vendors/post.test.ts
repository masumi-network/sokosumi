import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { emptyVendorLogos, testVendor } from "@/test-fixtures/vendor";

import mountCreateVendor from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { vendorCreateMock, vendorMemberCreateMock, transactionMock } =
  vi.hoisted(() => ({
    vendorCreateMock: vi.fn(),
    vendorMemberCreateMock: vi.fn(),
    transactionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      create: vendorCreateMock,
    },
    vendorMember: {
      create: vendorMemberCreateMock,
    },
    $transaction: transactionMock,
  },
}));

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_create_vendor_test");
    c.set("isAuthenticated", authContext != null);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountCreateVendor(app);

  return app;
}

describe("POST /vendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const createdVendor = {
      ...testVendor,
      name: "Acme Labs",
      slug: "acme-labs",
      logoLight: null,
      logoDark: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    vendorCreateMock.mockResolvedValue(createdVendor);
    vendorMemberCreateMock.mockResolvedValue({
      id: "vm_1",
      vendorId: createdVendor.id,
      userId: "user_dev",
      role: "admin",
    });
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          vendor: { create: vendorCreateMock },
          vendorMember: { create: vendorMemberCreateMock },
        }),
    );
  });

  it("creates a vendor and makes the caller admin", async () => {
    const app = createApp({
      actor: "user",
      userId: "user_dev",
      organizationId: null,
      role: "user",
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Labs", slug: "acme-labs" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(vendorCreateMock).toHaveBeenCalledWith({
      data: {
        name: "Acme Labs",
        slug: "acme-labs",
        logoLight: null,
        logoDark: null,
      },
    });
    expect(vendorMemberCreateMock).toHaveBeenCalledWith({
      data: {
        vendorId: testVendor.id,
        userId: "user_dev",
        role: "admin",
      },
    });
    expect(body.data).toEqual({
      id: testVendor.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Acme Labs",
      slug: "acme-labs",
      logos: emptyVendorLogos,
      role: "admin",
    });
  });

  it("rejects coworker actors", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: testVendor.id,
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Labs", slug: "acme-labs" }),
    });

    expect(response.status).toBe(403);
    expect(vendorCreateMock).not.toHaveBeenCalled();
  });

  it("maps slug conflicts to 409", async () => {
    const slugError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["slug"] },
    });
    transactionMock.mockRejectedValue(slugError);

    const app = createApp({
      actor: "user",
      userId: "user_dev",
      organizationId: null,
      role: "user",
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Labs", slug: "acme-labs" }),
    });

    expect(response.status).toBe(409);
  });
});
