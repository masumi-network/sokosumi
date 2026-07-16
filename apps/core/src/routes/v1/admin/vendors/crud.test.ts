import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { emptyVendorLogos, testVendor } from "@/test-fixtures/vendor";

import mountPatchAdminVendor from "./[id]/patch";
import mountGetAdminVendors from "./get";
import mountPostAdminVendor from "./post";

const {
  vendorCreateMock,
  vendorFindManyMock,
  vendorFindUniqueMock,
  vendorUpdateMock,
} = vi.hoisted(() => ({
  vendorCreateMock: vi.fn(),
  vendorFindManyMock: vi.fn(),
  vendorFindUniqueMock: vi.fn(),
  vendorUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      create: vendorCreateMock,
      findMany: vendorFindManyMock,
      findUnique: vendorFindUniqueMock,
      update: vendorUpdateMock,
    },
  },
}));

function createVendor(overrides: Partial<typeof testVendor> = {}) {
  return {
    ...testVendor,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_vendor_crud_test");
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
  mountGetAdminVendors(app as unknown as OpenAPIHonoWithAuth);
  mountPostAdminVendor(app as unknown as OpenAPIHonoWithAuth);
  mountPatchAdminVendor(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("admin vendor CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindManyMock.mockResolvedValue([createVendor()]);
    vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
    vendorCreateMock.mockResolvedValue(createVendor());
    vendorUpdateMock.mockResolvedValue(
      createVendor({ name: "Updated Vendor" }),
    );
  });

  it("lists vendors ordered by display name and slug", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(vendorFindManyMock).toHaveBeenCalledWith({
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });
  });

  it("returns 409 when the vendor slug already exists", async () => {
    vendorCreateMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["slug"] },
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Serviceplan",
        slug: "serviceplan",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("creates a vendor", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Serviceplan",
        slug: "serviceplan",
        logos: {
          light: "https://example.com/logo-light.png",
          dark: "https://example.com/logo-dark.png",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(vendorCreateMock).toHaveBeenCalledWith({
      data: {
        name: "Serviceplan",
        slug: "serviceplan",
        logoLight: "https://example.com/logo-light.png",
        logoDark: "https://example.com/logo-dark.png",
      },
    });
  });

  it("patches a vendor", async () => {
    const app = createApp();
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated Vendor",
        logos: emptyVendorLogos,
      }),
    });

    expect(response.status).toBe(200);
    expect(vendorFindUniqueMock).toHaveBeenCalledWith({
      where: { id: testVendor.id },
      select: { id: true },
    });
    expect(vendorUpdateMock).toHaveBeenCalledWith({
      where: { id: testVendor.id },
      data: {
        name: "Updated Vendor",
        slug: undefined,
        logoLight: null,
        logoDark: null,
      },
    });
  });

  it("returns 404 when patching a missing vendor", async () => {
    vendorFindUniqueMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Missing Vendor",
      }),
    });

    expect(response.status).toBe(404);
    expect(vendorUpdateMock).not.toHaveBeenCalled();
  });
});
