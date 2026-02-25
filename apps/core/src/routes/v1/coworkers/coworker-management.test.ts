import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteCoworkerById from "./[id]/delete";
import mountPatchCoworkerById from "./[id]/patch";
import mountPostCoworker from "./post";

const {
  userFindUniqueMock,
  coworkerFindFirstAuthMock,
  prismaTransactionMock,
  coworkerFindUniqueMock,
  coworkerFindFirstTxMock,
  coworkerCreateMock,
  coworkerUpdateManyMock,
  coworkerApiKeyUpdateManyMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstAuthMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  coworkerFindFirstTxMock: vi.fn(),
  coworkerCreateMock: vi.fn(),
  coworkerUpdateManyMock: vi.fn(),
  coworkerApiKeyUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstAuthMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

interface TransactionMock {
  coworker: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  coworkerApiKey: {
    updateMany: ReturnType<typeof vi.fn>;
  };
}

interface AppOptions {
  userId?: string;
}

function createApp(options: AppOptions = {}) {
  const { userId = "user_123" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
    });

    return await next();
  });

  mountPostCoworker(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerById(app as unknown as OpenAPIHonoWithAuth);

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
    isWhitelisted: false,
    slug: "ops-agent",
    name: "Ops Agent",
    caption: "Senior Campaign Partner",
    company: "Serviceplan",
    companyLogo: "https://example.com/company-logo",
    url: "https://example.com",
    email: "ops@example.com",
    description: "Ops helper",
    image: "https://example.com/logo",
    userId: "user_123",
    ...overrides,
  };
}

describe("coworker management CRUD endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    coworkerFindFirstAuthMock.mockResolvedValue({
      id: "cow_123",
      userId: "user_123",
    });
  });

  it("creates coworker and auto-assigns authenticated creator userId", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(createCoworkerRecord()),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        email: "ops@example.com",
      }),
    });

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_123",
          isWhitelisted: false,
        }),
      }),
    );
  });

  it("ignores request isWhitelisted and persists false by default", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(createCoworkerRecord()),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        email: "ops@example.com",
        isWhitelisted: true,
      }),
    });

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isWhitelisted: false,
        }),
      }),
    );
  });

  it("returns 409 when create hits a slug unique race (P2002)", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockRejectedValue({
          code: "P2002",
          meta: {
            target: ["slug"],
          },
        }),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        email: "ops@example.com",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects create when name is shorter than 3 characters", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "ab",
        email: "ops@example.com",
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects create when companyLogo is not a valid HTTP URL", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        email: "ops@example.com",
        companyLogo: "not-a-url",
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("updates coworker metadata as creator", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            name: "Updated Ops Agent",
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Ops Agent",
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerFindFirstAuthMock).toHaveBeenCalledWith({
      where: { id: "cow_123", archivedAt: null },
      select: { id: true, userId: true },
    });
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "cow_123",
          archivedAt: null,
        },
        data: expect.objectContaining({
          name: "Updated Ops Agent",
        }),
      }),
    );

    const updateCall = coworkerUpdateManyMock.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty("slug");
    expect(updateCall.data).not.toHaveProperty("isWhitelisted");
  });

  it("allows admin to update metadata for another user's coworker", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
    coworkerFindFirstAuthMock.mockResolvedValue({
      id: "cow_123",
      userId: "owner_999",
    });

    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            userId: "owner_999",
            name: "Updated by admin",
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
    });
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated by admin",
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerFindFirstAuthMock).not.toHaveBeenCalled();
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "cow_123",
          archivedAt: null,
        },
        data: expect.objectContaining({
          name: "Updated by admin",
        }),
      }),
    );
  });

  it("rejects update when name is shorter than 3 characters", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "ab",
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects update when url is not a valid HTTP URL", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "mailto:ops@example.com",
      }),
    });

    expect(response.status).toBe(400);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("archives coworker and revokes active API keys in one transaction", async () => {
    const archivedRecord = createCoworkerRecord({
      archivedAt: new Date("2026-02-20T11:00:00.000Z"),
    });
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(archivedRecord),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock.mockResolvedValue({
          count: 2,
        }),
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(coworkerFindFirstAuthMock).toHaveBeenCalledWith({
      where: { id: "cow_123", archivedAt: null },
      select: { id: true, userId: true },
    });
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      data: {
        archivedAt: expect.any(Date),
      },
    });
    expect(coworkerApiKeyUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          coworkerId: "cow_123",
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      }),
    );
    expect(coworkerFindFirstTxMock).toHaveBeenCalledWith({
      where: { id: "cow_123" },
    });
  });

  it("allows admin to archive coworker owned by another user", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
    coworkerFindFirstAuthMock.mockResolvedValue({
      id: "cow_123",
      userId: "owner_999",
    });

    const archivedRecord = createCoworkerRecord({
      userId: "owner_999",
      archivedAt: new Date("2026-02-20T11:00:00.000Z"),
    });
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(archivedRecord),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock.mockResolvedValue({
          count: 2,
        }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
    });
    const response = await app.request("http://localhost/cow_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(coworkerFindFirstAuthMock).not.toHaveBeenCalled();
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      data: {
        archivedAt: expect.any(Date),
      },
    });
    expect(coworkerApiKeyUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          coworkerId: "cow_123",
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      }),
    );
  });

  it("returns 404 when archiving already-archived coworker (atomic update)", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 0 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
    };

    mockTransaction(tx);

    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      data: {
        archivedAt: expect.any(Date),
      },
    });
    expect(coworkerApiKeyUpdateManyMock).not.toHaveBeenCalled();
  });
});
