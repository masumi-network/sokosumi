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
      authContext: {
        userId: string;
        organizationId: string | null;
        coworkerId: string | null;
      };
    },
  ) => {
    c.set("isAuthenticated", context.isAuthenticated);
    c.set("authContext", context.authContext);
  },
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
  authContext: {
    userId: string;
    organizationId: string | null;
    coworkerId: string | null;
  };
};

function createApp(initialOrganizationId: string | null) {
  const app = new Hono<{
    Variables: Variables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      userId: "user_123",
      organizationId: initialOrganizationId,
      coworkerId: null,
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
    const app = createApp("org_existing");
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "user_123",
      organizationId: "org_existing",
      coworkerId: null,
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("does not query organization when header is missing", async () => {
    const app = createApp(null);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "user_123",
      organizationId: null,
      coworkerId: null,
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

    const app = createApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "user_123",
      organizationId: "org_new",
      coworkerId: null,
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

  it("returns 403 when organization slug does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);

    const app = createApp(null);
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

    const app = createApp(null);
    const response = await app.request("http://localhost/", {
      headers: {
        "x-organization-slug": "new-org",
      },
    });

    expect(response.status).toBe(403);
  });
});
