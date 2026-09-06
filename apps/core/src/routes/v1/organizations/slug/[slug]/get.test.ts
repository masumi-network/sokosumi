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

let mountGetOrganizationBySlug: (app: OpenAPIHonoWithAuth) => void;
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

  // Mirror the mount order in the organizations router so the test also
  // covers `/slug/{slug}` taking precedence over `/{id}`.
  mountGetOrganizationBySlug(app);
  mountGetOrganization(app);

  return app;
}

function mockOrgLookup(args: { organization: unknown; member?: unknown }) {
  organizationFindUniqueMock.mockResolvedValue(args.organization);
  memberFindUniqueMock.mockResolvedValue(args.member ?? null);
}

beforeAll(async () => {
  mountGetOrganizationBySlug = (await import("./get")).default;
  mountGetOrganization = (await import("../../[id]/get")).default;
});

describe("GET /organizations/slug/{slug}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const app = createApp(null);

    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT);

    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(403);
  });

  it("returns 403 when the user is not a member of the organization", async () => {
    mockOrgLookup({
      organization: createOrganization(),
      member: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(403);
  });

  it("returns 404 when no organization matches the slug", async () => {
    mockOrgLookup({ organization: null });

    const app = createApp();
    const response = await app.request("http://localhost/slug/missing-org");

    expect(response.status).toBe(404);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the raw organization record when resolved by slug", async () => {
    mockOrgLookup({
      organization: createOrganization({
        metadata: '{"url":"https://example.com"}',
        stripeCustomerId: "cus_123",
      }),
      member: { role: "member" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/slug/acme");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "org_123",
      name: "Acme",
      slug: "acme",
      logo: null,
      metadata: '{"url":"https://example.com"}',
      stripeCustomerId: "cus_123",
    });
    expect(body.data).not.toHaveProperty("role");
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { slug: "acme" },
    });
  });

  it("is not shadowed by the `/{id}` route", async () => {
    mockOrgLookup({
      organization: createOrganization(),
      member: { role: "member" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(200);
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { slug: "acme" },
    });
  });
});
