import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPatchCoworkerWhitelistById from "./patch";

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

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "admin_123",
      organizationId: null,
      role: "admin",
    });

    return await next();
  });

  mountPatchCoworkerWhitelistById(app);

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

describe("PATCH /coworkers/{id}/whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates whitelist status to true", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            isWhitelisted: true,
          }),
        ),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/whitelist", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isWhitelisted: true,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.priority).toBe(0);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
      },
      data: {
        isWhitelisted: true,
      },
    });
  });

  it("updates whitelist status to false", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            isWhitelisted: false,
          }),
        ),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/whitelist", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isWhitelisted: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.priority).toBe(0);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
      },
      data: {
        isWhitelisted: false,
      },
    });
  });

  it("updates whitelist status for archived coworker", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            archivedAt: new Date("2026-03-01T00:00:00.000Z"),
            isWhitelisted: true,
          }),
        ),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/whitelist", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isWhitelisted: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
      },
      data: {
        isWhitelisted: true,
      },
    });
  });

  it("returns 404 when coworker does not exist", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 0 }),
        findFirst: coworkerFindFirstMock,
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/whitelist", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isWhitelisted: true,
      }),
    });

    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });
});
