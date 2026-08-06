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

    if (
      (authContext.actor === "coworker" ||
        authContext.actor === "orchestrator") &&
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

  mountGetOrganization(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
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
    const response = await app.request("http://localhost/org_123");

    expect(response.status).toBe(403);
  });

  it("returns 404 when the organization does not exist", async () => {
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
    const response = await app.request("http://localhost/missing-org");

    expect(response.status).toBe(404);
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });

  it("returns the organization payload when resolved by id", async () => {
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
    const tx: TransactionMock = {
      organization: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
      },
      member: {
        findUnique: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/acme");

    expect(response.status).toBe(404);
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "acme" },
    });
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });
});
