import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { organizationFindUniqueMock, memberFindUniqueMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserAuthContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountGetOrganizationDesignMd: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetOrganizationDesignMd(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null, metadata: unknown) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123", metadata });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganizationDesignMd = module.default;
});

describe("GET /organizations/{id}/design-md", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await createApp().request(
      "http://localhost/missing/design-md",
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null, JSON.stringify({}));
    const response = await createApp().request(
      "http://localhost/org_123/design-md",
    );
    expect(response.status).toBe(403);
  });

  it("returns the organization's stored DESIGN.md for any member", async () => {
    setMembership(
      "member",
      JSON.stringify({
        designMdUrl: "https://blob.example/org.md",
        designMdExtractionId: "9",
      }),
    );
    const response = await createApp().request(
      "http://localhost/org_123/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      url: "https://blob.example/org.md",
      extractionId: "9",
    });
  });

  it("returns null when the organization has no DESIGN.md", async () => {
    setMembership("member", JSON.stringify({}));
    const response = await createApp().request(
      "http://localhost/org_123/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toBeNull();
  });
});
