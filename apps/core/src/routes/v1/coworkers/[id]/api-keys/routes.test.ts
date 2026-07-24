import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteCoworkerApiKey from "./delete";
import mountGetCoworkerApiKeys from "./get";
import mountPatchCoworkerApiKey from "./patch";
import mountPostCoworkerApiKey from "./post";

const {
  userFindUniqueMock,
  coworkerFindFirstMock,
  vendorMemberFindFirstMock,
  coworkerAssignmentFindFirstMock,
  coworkerApiKeyFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  coworkerAssignmentFindFirstMock: vi.fn(),
  coworkerApiKeyFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    vendorMember: {
      findFirst: vendorMemberFindFirstMock,
    },
    coworkerAssignment: {
      findFirst: coworkerAssignmentFindFirstMock,
    },
    coworkerApiKey: {
      findMany: coworkerApiKeyFindManyMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

interface TransactionMock {
  coworker: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  coworkerApiKey: {
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
}

function createApiKeyRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "cokey_123",
    coworkerId: "cow_123",
    name: "Primary key",
    keyStart: "coworker_abcdefgh",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    updatedAt: new Date("2026-02-20T10:00:00.000Z"),
    ...overrides,
  };
}

function createApp(userId = "owner_123", role = "user") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role,
    });
    return await next();
  });

  mountGetCoworkerApiKeys(app as unknown as OpenAPIHonoWithAuth);
  mountPostCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

const vendorId = "01960001-0001-7001-8001-000000000001";

function mockAssignedDeveloperAccess() {
  coworkerFindFirstMock.mockResolvedValue({
    id: "cow_123",
    vendorId,
  });
  vendorMemberFindFirstMock.mockResolvedValue(null);
  coworkerAssignmentFindFirstMock.mockResolvedValue({ id: "assign_1" });
}

describe("coworker API key protected endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    mockAssignedDeveloperAccess();
  });

  it("creates a key and only returns creation fields", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        create: vi.fn().mockResolvedValue(createApiKeyRecord()),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123/api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Primary key",
      }),
    });

    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.id).toBe("cokey_123");
    expect(body.data.token).toEqual(expect.stringMatching(/^coworker_/));
    expect(body.data.name).toBe("Primary key");
    expect(body.data.expiresAt).toBeNull();
    expect(body.data.coworkerId).toBeUndefined();
    expect(body.data.keyStart).toBeUndefined();
    expect(body.data.keyHash).toBeUndefined();
    expect(body.data.revokedAt).toBeUndefined();
    expect(body.data.createdAt).toBeUndefined();
    expect(body.data.updatedAt).toBeUndefined();
    expect(tx.coworker.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      data: {
        updatedAt: expect.any(Date),
      },
    });
    expect(tx.coworkerApiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keyHash: expect.any(String),
          keyStart: expect.any(String),
        }),
      }),
    );
  });

  it("lists keys without exposing keyHash", async () => {
    coworkerApiKeyFindManyMock.mockResolvedValue([createApiKeyRecord()]);
    const app = createApp();

    const response = await app.request("http://localhost/cow_123/api-keys");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data[0].keyHash).toBeUndefined();
    expect(body.data[0].keyStart).toBe("coworker_abcdefgh");
  });

  it("updates key metadata", async () => {
    const tx: TransactionMock = {
      coworker: {
        updateMany: vi.fn(),
      },
      coworkerApiKey: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi
          .fn()
          .mockResolvedValue(
            createApiKeyRecord({ name: "Updated key", expiresAt: null }),
          ),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      "http://localhost/cow_123/api-keys/cokey_123",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated key",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(tx.coworkerApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cokey_123",
        coworkerId: "cow_123",
        coworker: {
          archivedAt: null,
        },
      },
      data: {
        name: "Updated key",
        expiresAt: undefined,
      },
    });
  });

  it("soft-revokes a key and supports idempotent delete", async () => {
    const firstTx: TransactionMock = {
      coworker: {
        updateMany: vi.fn(),
      },
      coworkerApiKey: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi
          .fn()
          .mockResolvedValue(
            createApiKeyRecord({ revokedAt: new Date("2026-02-20T11:00:00Z") }),
          ),
      },
    };
    mockTransaction(firstTx);

    const app = createApp();
    const firstResponse = await app.request(
      "http://localhost/cow_123/api-keys/cokey_123",
      {
        method: "DELETE",
      },
    );
    expect(firstResponse.status).toBe(200);
    expect(firstTx.coworkerApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cokey_123",
        coworkerId: "cow_123",
        revokedAt: null,
        coworker: {
          archivedAt: null,
        },
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });

    const secondTx: TransactionMock = {
      coworker: {
        updateMany: vi.fn(),
      },
      coworkerApiKey: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi
          .fn()
          .mockResolvedValue(
            createApiKeyRecord({ revokedAt: new Date("2026-02-20T11:00:00Z") }),
          ),
      },
    };
    mockTransaction(secondTx);

    const secondResponse = await app.request(
      "http://localhost/cow_123/api-keys/cokey_123",
      {
        method: "DELETE",
      },
    );
    expect(secondResponse.status).toBe(200);
    expect(secondTx.coworkerApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cokey_123",
        coworkerId: "cow_123",
        revokedAt: null,
        coworker: {
          archivedAt: null,
        },
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(secondTx.coworkerApiKey.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cokey_123",
        coworkerId: "cow_123",
        coworker: {
          archivedAt: null,
        },
      },
      select: {
        id: true,
        coworkerId: true,
        name: true,
        keyStart: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("allows platform admin to create an API key for any coworker", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      vendorId,
    });

    const tx: TransactionMock = {
      coworker: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        create: vi.fn().mockResolvedValue(createApiKeyRecord()),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp("admin_123", "admin");
    const response = await app.request("http://localhost/cow_123/api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Admin managed key",
      }),
    });

    expect(response.status).toBe(201);
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
    expect(tx.coworkerApiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coworkerId: "cow_123",
          name: "Admin managed key",
        }),
      }),
    );
  });

  it.each([
    { method: "GET", path: "/cow_123/api-keys" },
    {
      method: "POST",
      path: "/cow_123/api-keys",
      body: {
        name: "Primary key",
      },
    },
    {
      method: "PATCH",
      path: "/cow_123/api-keys/cokey_123",
      body: {
        name: "Updated key",
      },
    },
    { method: "DELETE", path: "/cow_123/api-keys/cokey_123" },
  ])(
    "returns 403 when user lacks membership access and calls $method $path",
    async ({ method, path, body }) => {
      coworkerFindFirstMock.mockResolvedValue({
        id: "cow_123",
        vendorId,
      });
      vendorMemberFindFirstMock.mockResolvedValue(null);
      coworkerAssignmentFindFirstMock.mockResolvedValue(null);

      const app = createApp("user_999");

      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(403);
    },
  );
});
