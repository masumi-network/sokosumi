import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
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
    $transaction: prismaTransactionMock,
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

interface TransactionMock {
  organization: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  member: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

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
  mountGetOrganizationBySlug(app as unknown as OpenAPIHonoWithAuth);
  mountGetOrganization(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
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
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member of the organization", async () => {
    const tx: TransactionMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(createOrganization()),
      },
      member: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(403);
  });

  it("returns 404 when no organization matches the slug", async () => {
    const tx: TransactionMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      member: {
        findUnique: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/slug/missing-org");

    expect(response.status).toBe(404);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });

  it("returns the raw organization record when resolved by slug", async () => {
    const tx: TransactionMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(
          createOrganization({
            metadata: '{"url":"https://example.com"}',
            stripeCustomerId: "cus_123",
          }),
        ),
      },
      member: {
        findUnique: vi.fn().mockResolvedValue({
          role: "member",
        }),
      },
    };
    mockTransaction(tx);

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
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: "acme" },
    });
  });

  it("is not shadowed by the `/{id}` route", async () => {
    const tx: TransactionMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(createOrganization()),
      },
      member: {
        findUnique: vi.fn().mockResolvedValue({
          role: "member",
        }),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/slug/acme");

    expect(response.status).toBe(200);
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: "acme" },
    });
  });
});
