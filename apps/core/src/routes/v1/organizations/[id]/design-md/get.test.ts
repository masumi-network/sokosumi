import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { organizationFindUniqueMock, memberFindUniqueMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (authContext?.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (authContext?.actor === "coworker" && authContext.context) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, { message: "User authentication required" });
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

// Let a coworker past the vendor grant gate so these cases exercise the
// organization binding, not grant policy (grant policy lives in
// coworker-user-context-binding.test.ts).
vi.mock("@/helpers/personal-workspace-error", () => ({
  resolveWorkspaceForContextOrNotFound: async () => ({ id: "workspace_a" }),
}));

vi.mock("@/helpers/vendor-grants", () => ({
  getWorkspaceGrant: async () => ({ status: "GRANTED" }),
  isGrantDeniedOrRevoked: () => false,
  throwGrantAccessError: () => {
    throw new Error("unexpected grant rejection");
  },
}));

/** A Serviceplan-style coworker key bound to org_123 by context headers. */
const COWORKER_IN_ORG_123: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: "org_123" },
};

/** The same key, bound to a different organization the user also belongs to. */
const COWORKER_IN_OTHER_ORG: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: "org_other" },
};

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
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetOrganizationDesignMd(app);
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

describe("GET /organizations/{id}/design-md organization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMembership("member", { designMd: "# Acme" });
  });

  it("serves the organization the coworker context is bound to", async () => {
    const app = createApp(COWORKER_IN_ORG_123);

    const response = await app.request("http://localhost/org_123/design-md");

    expect(response.status).toBe(200);
  });

  it("refuses an organization outside the coworker context", async () => {
    const app = createApp(COWORKER_IN_OTHER_ORG);

    const response = await app.request("http://localhost/org_123/design-md");

    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });
});
