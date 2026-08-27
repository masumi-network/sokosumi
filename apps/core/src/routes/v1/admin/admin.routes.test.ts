import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { searchUsersMock, searchOrganizationsMock, authContextState } =
  vi.hoisted(() => ({
    authContextState: {
      current: {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role: "admin",
      } as AuthenticationContext,
    },
    searchUsersMock: vi.fn(),
    searchOrganizationsMock: vi.fn(),
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

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: { searchUsers: searchUsersMock },
  organizationRepository: {
    searchOrganizations: searchOrganizationsMock,
  },
}));

const { default: mountSearchAdminUsers } = await import(
  "./search/users/get.js"
);
const { default: mountSearchAdminOrganizations } = await import(
  "./search/organizations/get.js"
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
  if (actor === "coworker") {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
  } else {
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role,
    };
  }

  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountRoutes(app);

  return app;
}

describe("admin search routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchUsersMock.mockResolvedValue([]);
    searchOrganizationsMock.mockResolvedValue([]);
  });

  describe("admin access", () => {
    it("returns 403 for non-admin users", async () => {
      const app = createApp(mountSearchAdminUsers, { role: "user" });
      const response = await app.request("http://localhost/users?query=ada");

      expect(response.status).toBe(403);
      expect(searchUsersMock).not.toHaveBeenCalled();
    });

    it("returns 403 for coworker auth", async () => {
      const app = createApp(mountSearchAdminUsers, { actor: "coworker" });
      const response = await app.request("http://localhost/users?query=ada");

      expect(response.status).toBe(403);
    });
  });

  describe("GET /admin/search/users", () => {
    it("returns mapped user options for an admin", async () => {
      searchUsersMock.mockResolvedValue([
        { id: "user_1", name: "Ada", email: "ada@example.com", role: "user" },
      ]);
      const app = createApp(mountSearchAdminUsers);

      const response = await app.request("http://localhost/users?query=ada");
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

      const response = await app.request("http://localhost/users");

      expect(response.status).toBe(200);
      expect(searchUsersMock).toHaveBeenCalledWith("", 20, expect.anything());
    });
  });

  describe("GET /admin/search/organizations", () => {
    it("returns mapped organization options for an admin", async () => {
      searchOrganizationsMock.mockResolvedValue([
        { id: "org_1", name: "Acme", slug: "acme", extra: "ignored" },
      ]);
      const app = createApp(mountSearchAdminOrganizations);

      const response = await app.request(
        "http://localhost/organizations?query=acme",
      );
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
});
