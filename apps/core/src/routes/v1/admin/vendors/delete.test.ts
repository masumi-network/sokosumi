import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";

import mountDeleteAdminVendor from "./[id]/delete";

const {
  vendorFindUniqueMock,
  coworkerCountMock,
  vendorDeleteMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
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

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountDeleteAdminVendor(app);

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
