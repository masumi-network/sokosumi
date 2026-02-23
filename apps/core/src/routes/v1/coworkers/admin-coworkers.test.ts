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
        slug: "ops-agent",
        name: "Ops Agent",
      }),
    });

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin_123",
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
        slug: "ops-agent",
        name: "Ops Agent",
      }),
    });

    expect(response.status).toBe(409);
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
  });

  it("returns 409 when update hits a slug unique race (P2002)", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstMock,
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockRejectedValue({
          code: "P2002",
          meta: {
            target: ["slug"],
          },
        }),
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
        slug: "new-ops-agent",
      }),
    });

    expect(response.status).toBe(409);
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
