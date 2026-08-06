import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  organizationFindUniqueMock,
  getMemberByUserIdAndOrganizationIdMock,
  getUserByIdMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    if (authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (
      authContext.actor === "orchestrator" &&
      "context" in authContext &&
      authContext.context
    ) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, {
      message:
        "Context headers (X-Context-User-Id) are required for this resource",
    });
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { organization: { findUnique: organizationFindUniqueMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const USER_AUTH_WITH_ORG: AuthenticationContext = {
  ...USER_AUTH_CONTEXT,
  organizationId: "org_1",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

let mountGetWorkspaceDesignMd: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetWorkspaceDesignMd(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetWorkspaceDesignMd = module.default;
});

describe("GET /workspaces/design-md", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/design-md",
    );
    expect(response.status).toBe(403);
  });

  it("uses the organization DESIGN.md when the active workspace org has one", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      id: "member_1",
    });
    organizationFindUniqueMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/org.md" }),
      name: "Acme Inc",
      logo: "https://blob.example/logo.png",
    });

    const response = await createApp(USER_AUTH_WITH_ORG).request(
      "http://localhost/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      expect.anything(),
    );
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/org.md",
      owner: {
        type: "organization",
        name: "Acme Inc",
        logo: "https://blob.example/logo.png",
      },
    });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("returns a null logo when the organization has none set", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      id: "member_1",
    });
    organizationFindUniqueMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/org.md" }),
      name: "Acme Inc",
      logo: null,
    });

    const response = await createApp(USER_AUTH_WITH_ORG).request(
      "http://localhost/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/org.md",
      owner: { type: "organization", name: "Acme Inc", logo: null },
    });
  });

  it("falls back to the personal DESIGN.md when the active org has none", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      id: "member_1",
    });
    organizationFindUniqueMock.mockResolvedValueOnce({
      metadata: JSON.stringify({}),
      name: "Acme Inc",
    });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/user.md" }),
    });

    const response = await createApp(USER_AUTH_WITH_ORG).request(
      "http://localhost/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/user.md",
      owner: { type: "user" },
    });
  });

  it("does not expose the organization DESIGN.md to a non-member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/user.md" }),
    });

    const response = await createApp(USER_AUTH_WITH_ORG).request(
      "http://localhost/design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/user.md",
      owner: { type: "user" },
    });
  });

  it("returns the personal DESIGN.md when no organization workspace is active", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/user.md" }),
    });

    const response = await createApp().request("http://localhost/design-md");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/user.md",
      owner: { type: "user" },
    });
  });

  it("returns null when neither workspace has a DESIGN.md", async () => {
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });

    const response = await createApp().request("http://localhost/design-md");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toBeNull();
  });
});
