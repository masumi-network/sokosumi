import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostCoworkerUnarchive from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { prismaTransactionMock, coworkerUpdateManyMock, coworkerFindFirstMock } =
  vi.hoisted(() => ({
    prismaTransactionMock: vi.fn(),
    coworkerUpdateManyMock: vi.fn(),
    coworkerFindFirstMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

interface TransactionMock {
  coworker: {
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
}

const vendorId = "01960001-0001-7001-8001-000000000001";

const sampleVendor = {
  id: vendorId,
  createdAt: new Date("2026-02-20T10:00:00.000Z"),
  updatedAt: new Date("2026-02-20T10:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logoLight: null,
  logoDark: null,
};

function createApp(role = "admin") {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "admin_123",
      organizationId: null,
      role,
    });

    return await next();
  });

  mountPostCoworkerUnarchive(app);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

function createCoworkerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "cow_123",
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    updatedAt: new Date("2026-02-20T10:00:00.000Z"),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "ops-agent",
    name: "Ops Agent",
    caption: null,
    url: null,
    baseURL: null,
    description: null,
    capabilities: [],
    image: null,
    userId: "user_123",
    vendorId,
    vendor: sampleVendor,
    metadata: null,
    ...overrides,
  };
}

describe("POST /coworkers/{id}/unarchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears archivedAt for archived coworker", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            archivedAt: null,
          }),
        ),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/unarchive", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.archivedAt).toBeNull();
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: { not: null },
      },
      data: {
        archivedAt: null,
      },
    });
  });

  it("returns 404 when coworker is not archived", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 0 }),
        findFirst: coworkerFindFirstMock,
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/unarchive", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    const app = createApp("user");
    const response = await app.request("http://localhost/cow_123/unarchive", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
