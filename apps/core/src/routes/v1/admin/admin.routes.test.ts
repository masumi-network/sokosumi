import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const { searchUsersMock, searchOrganizationsMock, getOrgBySlugMock } =
  vi.hoisted(() => ({
    searchUsersMock: vi.fn(),
    searchOrganizationsMock: vi.fn(),
    getOrgBySlugMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: { searchUsers: searchUsersMock },
  organizationRepository: {
    searchOrganizations: searchOrganizationsMock,
    getOrganizationLimitedInfoBySlug: getOrgBySlugMock,
  },
}));

const { default: mountSearchAdminUsers } = await import("./users/get.js");
const { default: mountSearchAdminOrganizations } = await import(
  "./organizations/get.js"
);
const { default: mountGetAdminOrganizationBySlug } = await import(
  "./organizations/[slug]/get.js"
);

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  options: AppOptions = {},
) {
  const { role = "admin", actor = "user" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", { actor: "coworker", coworkerId: "cow_123" });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role,
      });
    }

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
  mountRoutes(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("admin search routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchUsersMock.mockResolvedValue([]);
    searchOrganizationsMock.mockResolvedValue([]);
    getOrgBySlugMock.mockResolvedValue(null);
  });

  describe("admin access", () => {
    it("returns 403 for non-admin users", async () => {
      const app = createApp(mountSearchAdminUsers, { role: "user" });
      const response = await app.request("http://localhost/?query=ada");

      expect(response.status).toBe(403);
      expect(searchUsersMock).not.toHaveBeenCalled();
    });

    it("returns 403 for coworker auth", async () => {
      const app = createApp(mountSearchAdminUsers, { actor: "coworker" });
      const response = await app.request("http://localhost/?query=ada");

      expect(response.status).toBe(403);
    });
  });

  describe("GET /admin/users", () => {
    it("returns mapped user options for an admin", async () => {
      searchUsersMock.mockResolvedValue([
        { id: "user_1", name: "Ada", email: "ada@example.com", role: "user" },
      ]);
      const app = createApp(mountSearchAdminUsers);

      const response = await app.request("http://localhost/?query=ada");
      const body = (await response.json()) as {
        data: Array<{ id: string; name: string; email: string }>;
      };

      expect(response.status).toBe(200);
      expect(searchUsersMock).toHaveBeenCalledWith(
        "ada",
        20,
        expect.anything(),
      );
      expect(body.data).toEqual([
        { id: "user_1", name: "Ada", email: "ada@example.com" },
      ]);
    });

    it("passes an empty string when query is omitted", async () => {
      const app = createApp(mountSearchAdminUsers);

      const response = await app.request("http://localhost/");

      expect(response.status).toBe(200);
      expect(searchUsersMock).toHaveBeenCalledWith("", 20, expect.anything());
    });
  });

  describe("GET /admin/organizations", () => {
    it("returns mapped organization options for an admin", async () => {
      searchOrganizationsMock.mockResolvedValue([
        { id: "org_1", name: "Acme", slug: "acme", extra: "ignored" },
      ]);
      const app = createApp(mountSearchAdminOrganizations);

      const response = await app.request("http://localhost/?query=acme");
      const body = (await response.json()) as {
        data: Array<{ id: string; name: string; slug: string }>;
      };

      expect(response.status).toBe(200);
      expect(searchOrganizationsMock).toHaveBeenCalledWith(
        "acme",
        20,
        expect.anything(),
      );
      expect(body.data).toEqual([{ id: "org_1", name: "Acme", slug: "acme" }]);
    });
  });

  describe("GET /admin/organizations/{slug}", () => {
    it("returns the organization option when found", async () => {
      getOrgBySlugMock.mockResolvedValue({
        id: "org_1",
        name: "Acme",
        slug: "acme",
        extra: "ignored",
      });
      const app = createApp(mountGetAdminOrganizationBySlug);

      const response = await app.request("http://localhost/acme");
      const body = (await response.json()) as {
        data: { id: string; name: string; slug: string } | null;
      };

      expect(response.status).toBe(200);
      expect(getOrgBySlugMock).toHaveBeenCalledWith("acme", expect.anything());
      expect(body.data).toEqual({ id: "org_1", name: "Acme", slug: "acme" });
    });

    it("returns 404 when no organization matches the slug", async () => {
      const app = createApp(mountGetAdminOrganizationBySlug);

      const response = await app.request("http://localhost/missing");

      expect(response.status).toBe(404);
    });
  });
});
