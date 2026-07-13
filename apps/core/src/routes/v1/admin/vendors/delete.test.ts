import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";

import mountDeleteAdminVendor from "./[id]/delete";

const { vendorFindUniqueMock, coworkerCountMock, vendorDeleteMock } =
  vi.hoisted(() => ({
    vendorFindUniqueMock: vi.fn(),
    coworkerCountMock: vi.fn(),
    vendorDeleteMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      findUnique: vendorFindUniqueMock,
      delete: vendorDeleteMock,
    },
    coworker: {
      count: coworkerCountMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_vendor_delete_test");
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
  mountDeleteAdminVendor(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("DELETE /admin/vendors/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindUniqueMock.mockResolvedValue({ id: testVendor.id });
    coworkerCountMock.mockResolvedValue(0);
    vendorDeleteMock.mockResolvedValue({ id: testVendor.id });
  });

  it("deletes an unused vendor", async () => {
    const app = createApp();
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(vendorDeleteMock).toHaveBeenCalledWith({
      where: { id: testVendor.id },
    });
  });

  it("returns 409 when coworkers reference the vendor", async () => {
    coworkerCountMock.mockResolvedValueOnce(2);

    const app = createApp();
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(vendorDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the vendor is missing", async () => {
    vendorFindUniqueMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/${testVendor.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(vendorDeleteMock).not.toHaveBeenCalled();
  });
});
