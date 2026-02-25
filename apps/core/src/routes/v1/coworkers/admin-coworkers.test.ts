import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteCoworkerById from "./[id]/delete";
import mountPatchCoworkerById from "./[id]/patch";
import mountPostCoworker from "./post";

const {
  userFindUniqueMock,
  prismaTransactionMock,
  coworkerFindUniqueMock,
  coworkerFindFirstMock,
  coworkerCreateMock,
  coworkerUpdateManyMock,
  coworkerUpdateMock,
  coworkerApiKeyUpdateManyMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  coworkerCreateMock: vi.fn(),
  coworkerUpdateManyMock: vi.fn(),
  coworkerUpdateMock: vi.fn(),
  coworkerApiKeyUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
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
    update: ReturnType<typeof vi.fn>;
  };
  coworkerApiKey: {
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "admin_123",
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
    isWhitelisted: true,
    slug: "ops-agent",
    name: "Ops Agent",
    caption: "Senior Campaign Partner",
    company: "Serviceplan",
    companyLogo: "https://example.com/company-logo",
    url: "https://example.com",
    email: "ops@example.com",
    description: "Ops helper",
    image: "https://example.com/logo",
    userId: "admin_123",
    ...overrides,
  };
}

describe("coworker admin CRUD endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
  });

  it("creates coworker and auto-assigns authenticated admin userId", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock,
        create: coworkerCreateMock.mockResolvedValue(createCoworkerRecord()),
        updateMany: coworkerUpdateManyMock,
        update: coworkerUpdateMock,
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
          userId: "admin_123",
          isWhitelisted: false,
        }),
      }),
    );
  });

  it("creates coworker with explicit isWhitelisted value", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock,
        create: coworkerCreateMock.mockResolvedValue(
          createCoworkerRecord({
            isWhitelisted: true,
          }),
        ),
        updateMany: coworkerUpdateManyMock,
        update: coworkerUpdateMock,
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
          isWhitelisted: true,
        }),
      }),
    );
  });

  it("returns 409 when create hits a slug unique race (P2002)", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock,
        create: coworkerCreateMock.mockRejectedValue({
          code: "P2002",
          meta: {
            target: ["slug"],
          },
        }),
        updateMany: coworkerUpdateManyMock,
        update: coworkerUpdateMock,
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

  it("updates coworker metadata", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            name: "Updated Ops Agent",
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        update: coworkerUpdateMock,
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
    expect(coworkerFindUniqueMock).not.toHaveBeenCalled();
  });

  it("updates coworker isWhitelisted flag", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock.mockResolvedValue(
          createCoworkerRecord({
            isWhitelisted: false,
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        update: coworkerUpdateMock,
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
        isWhitelisted: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "cow_123",
          archivedAt: null,
        },
        data: expect.objectContaining({
          isWhitelisted: false,
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
        findFirst: coworkerFindFirstMock.mockResolvedValue(archivedRecord),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
        update: coworkerUpdateMock,
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
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: { id: "cow_123" },
    });
  });

  it("returns 404 when archiving already-archived coworker (atomic update)", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstMock,
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 0 }),
        update: coworkerUpdateMock,
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
