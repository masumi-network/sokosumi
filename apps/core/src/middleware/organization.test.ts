import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import { organizationHeaderMiddleware } from "./organization";

const { memberFindFirstMock } = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  setAuthContext: (
    c: {
      set: (key: "isAuthenticated" | "authContext", value: unknown) => void;
    },
    context: {
      isAuthenticated: boolean;
      authContext:
        | {
            actor: "user";
            userId: string;
            organizationId: string | null;
            role: string;
          }
        | {
            actor: "coworker";
            coworkerId: string;
            vendorId: string;
          };
    },
  ) => {
    c.set("isAuthenticated", context.isAuthenticated);
    c.set("authContext", context.authContext);
  },
  isUserAuthContext: (
    authContext:
      | {
          actor: "user";
          userId: string;
          organizationId: string | null;
          role: string;
        }
      | {
          actor: "coworker";
          coworkerId: string;
          vendorId: string;
        },
  ) => authContext.actor === "user",
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: {
      findFirst: memberFindFirstMock,
    },
  },
}));

type Variables = {
  isAuthenticated: boolean;
  authContext:
    | {
        actor: "user";
        userId: string;
        organizationId: string | null;
        role: string;
      }
    | {
        actor: "coworker";
        coworkerId: string;
        vendorId: string;
      };
};

function createUserApp(initialOrganizationId: string | null) {
  const app = new Hono<{
    Variables: Variables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: initialOrganizationId,
      role: "user",
    });
    return await next();
  });

  app.use("*", organizationHeaderMiddleware);

  app.get("/", (c) => {
    return c.json(c.var.authContext);
  });

  return app;
}

function createCoworkerApp() {
  const app = new Hono<{
    Variables: Variables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    });
    return await next();
  });

  app.use("*", organizationHeaderMiddleware);

  app.get("/", (c) => {
    return c.json(c.var.authContext);
  });

  return app;
}

describe("organizationHeaderMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query organization when organizationId is already set", async () => {
    const app = createUserApp("org_existing");
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: "org_existing",
      role: "user",
    });
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("does not query organization when header is missing", async () => {
    const app = createUserApp(null);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("sets organizationId when header slug is valid and user is a member", async () => {
    memberFindFirstMock.mockResolvedValue({
      organizationId: "org_new",
    });

    const app = createUserApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: "org_new",
      role: "user",
    });
    expect(memberFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        organization: {
          slug: "new-org",
        },
      },
      select: { organizationId: true },
    });
  });

  it("does not resolve organization for coworker auth", async () => {
    const app = createCoworkerApp();
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    });
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 403 when organization slug does not exist", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const app = createUserApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "missing-org",
      },
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 when user is not a member of the organization", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const app = createUserApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(403);
  });
});
