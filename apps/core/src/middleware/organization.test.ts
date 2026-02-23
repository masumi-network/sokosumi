import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationHeaderMiddleware } from "./organization";

const { organizationFindUniqueMock, memberFindUniqueMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
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
          }
        | {
            actor: "coworker";
            coworkerId: string;
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
        }
      | {
          actor: "coworker";
          coworkerId: string;
        },
  ) => authContext.actor === "user",
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
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
      }
    | {
        actor: "coworker";
        coworkerId: string;
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
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("does not query organization when header is missing", async () => {
    const app = createUserApp(null);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("sets organizationId when header slug is valid and user is a member", async () => {
    organizationFindUniqueMock.mockResolvedValue({
      id: "org_new",
    });
    memberFindUniqueMock.mockResolvedValue({
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
    });
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { slug: "new-org" },
      select: { id: true },
    });
    expect(memberFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "user_123",
          organizationId: "org_new",
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
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 403 when organization slug does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);

    const app = createUserApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "missing-org",
      },
    });

    expect(response.status).toBe(403);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a member of the organization", async () => {
    organizationFindUniqueMock.mockResolvedValue({
      id: "org_new",
    });
    memberFindUniqueMock.mockResolvedValue(null);

    const app = createUserApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(403);
  });
});
