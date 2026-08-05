import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";

import mountListVendors from "./get";

const { vendorFindManyMock } = vi.hoisted(() => ({
  vendorFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      findMany: vendorFindManyMock,
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
    c.set("requestId", "req_list_vendors_test");
    c.set("isAuthenticated", authContext != null);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountListVendors(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /vendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindManyMock.mockResolvedValue([
      {
        ...testVendor,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
  });

  it("lists vendors for an authenticated user", async () => {
    const app = createApp({
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
    });

    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vendorFindManyMock).toHaveBeenCalledWith({
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });
    expect(body.data).toEqual([
      {
        id: testVendor.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        name: testVendor.name,
        slug: testVendor.slug,
        logos: {
          light: testVendor.logoLight,
          dark: testVendor.logoDark,
        },
      },
    ]);
  });

  it("rejects coworker auth without user context headers", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: testVendor.id,
      isDelegationApproved: true,
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(vendorFindManyMock).not.toHaveBeenCalled();
  });

  it("lists vendors for coworker auth with user context", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: testVendor.id,
      isDelegationApproved: true,
      context: {
        userId: "user_1",
        organizationId: null,
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(vendorFindManyMock).toHaveBeenCalled();
  });
});
