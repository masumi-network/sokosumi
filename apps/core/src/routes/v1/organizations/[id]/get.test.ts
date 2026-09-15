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
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }

    if (authContext.actor === "user") {
      return {
        source: "session" as const,
        ...authContext,
      };
    }

    if (authContext.actor === "coworker" && authContext.context) {
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
  default: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
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

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

let mountGetOrganization: (app: OpenAPIHonoWithAuth) => void;

function createOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: "org_123",
    createdAt: new Date("2026-03-16T09:00:00.000Z"),
    name: "Acme",
    slug: "acme",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    ...overrides,
  };
}

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");

    if (!authContext) {
      throw new HTTPException(401, {
        message: "Unauthorized",
      });
    }

    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountGetOrganization(app);

  return app;
}

function mockOrgLookup(args: { organization: unknown; member?: unknown }) {
  organizationFindUniqueMock.mockResolvedValue(args.organization);
  memberFindUniqueMock.mockResolvedValue(args.member ?? null);
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganization = module.default;
});

describe("GET /organizations/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const app = createApp(null);

    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT);

    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(403);
  });

  it("returns 403 when the user is not a member of the organization", async () => {
    mockOrgLookup({
      organization: createOrganization(),
      member: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(403);
  });

  it("returns 404 when the organization does not exist", async () => {
    mockOrgLookup({ organization: null });

    const app = createApp();
    const response = await app.request("http://localhost/missing-org");

    expect(response.status).toBe(404);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the organization payload when resolved by id", async () => {
    mockOrgLookup({
      organization: createOrganization(),
      member: { role: "member" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/org_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "org_123",
      slug: "acme",
      role: "member",
    });
  });

  it("returns 404 when the identifier only matches a slug", async () => {
    mockOrgLookup({ organization: null });

    const app = createApp();
    const response = await app.request("http://localhost/acme");

    expect(response.status).toBe(404);
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "acme" },
    });
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("GET /organizations/{id} organization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgLookup({
      organization: createOrganization(),
      member: { role: "member" },
    });
  });

  it("serves the organization the coworker context is bound to", async () => {
    const app = createApp(COWORKER_IN_ORG_123);

    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(200);
  });

  it("refuses an organization outside the coworker context", async () => {
    const app = createApp(COWORKER_IN_OTHER_ORG);

    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });
});
