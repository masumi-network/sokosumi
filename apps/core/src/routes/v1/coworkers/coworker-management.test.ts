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
  vendorFindUniqueMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstAuthMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  coworkerFindFirstTxMock: vi.fn(),
  coworkerCreateMock: vi.fn(),
  coworkerUpdateManyMock: vi.fn(),
  coworkerApiKeyUpdateManyMock: vi.fn(),
  vendorFindUniqueMock: vi.fn(),
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
  vendor: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

const vendorId = "01960001-0001-7001-8001-000000000001";

const sampleVendor = {
  id: vendorId,
  createdAt: new Date("2026-02-20T10:00:00.000Z"),
  updatedAt: new Date("2026-02-20T10:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logoLight: "https://example.com/company-logo",
  logoDark: null,
};

interface AppOptions {
  userId?: string;
  role?: string;
}

function createApp(options: AppOptions = {}) {
  const { userId = "user_123", role = "user" } = options;
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
    priority: 0,
    capabilities: [],
    slug: "ops-agent",
    name: "Ops Agent",
    caption: "Senior Campaign Partner",
    url: "https://example.com",
    description: "Ops helper",
    image: "https://example.com/logo",
    baseURL: null,
    userId: "user_123",
    vendorId,
    vendor: sampleVendor,
    metadata: null,
    ...overrides,
  };
}

function createTransactionMock(
  coworker: Partial<TransactionMock["coworker"]>,
): TransactionMock {
  return {
    coworker: {
      findUnique: coworkerFindUniqueMock,
      findFirst: coworkerFindFirstTxMock,
      create: coworkerCreateMock,
      updateMany: coworkerUpdateManyMock,
      ...coworker,
    },
    coworkerApiKey: {
      updateMany: coworkerApiKeyUpdateManyMock,
    },
    vendor: {
      findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
    },
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
    const tx = createTransactionMock({
      findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
      create: coworkerCreateMock.mockResolvedValue(createCoworkerRecord()),
    });

    mockTransaction(tx);

    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
      }),
    });

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin_123",
          isWhitelisted: false,
          priority: 0,
          baseURL: null,
        }),
      }),
    );
  });

  it("creates coworker with baseURL when provided", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(
          createCoworkerRecord({
            baseURL: "https://responses.example.com/v1",
          }),
        ),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
        baseURL: "https://responses.example.com/v1",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseURL: "https://responses.example.com/v1",
        }),
      }),
    );
    expect(body.data.baseURL).toBe("https://responses.example.com/v1");
  });

  it("creates coworker with explicit priority", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(
          createCoworkerRecord({
            priority: 10,
          }),
        ),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
      role: "admin",
    });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
        priority: 10,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin_123",
          priority: 10,
        }),
      }),
    );
    expect(body.data.priority).toBe(10);
  });

  it("rejects create for non-admin", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("creates coworker with normalized capabilities", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(
          createCoworkerRecord({
            capabilities: ["chat", "tasks"],
          }),
        ),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
        capabilities: ["tasks", "chat", "tasks"],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capabilities: ["chat", "tasks"],
        }),
      }),
    );
    expect(body.data.capabilities).toEqual(["chat", "tasks"]);
  });

  it("creates coworker with metadata channels", async () => {
    const metadata = {
      channels: {
        email: "foo@bar.com",
        whatsapp: "+49151xxxx",
      },
    };
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock.mockResolvedValue(null),
        findFirst: coworkerFindFirstTxMock,
        create: coworkerCreateMock.mockResolvedValue(
          createCoworkerRecord({ metadata }),
        ),
        updateMany: coworkerUpdateManyMock,
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
        metadata,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(coworkerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata,
        }),
      }),
    );
    expect(body.data.metadata).toEqual(metadata);
  });

  it("rejects isWhitelisted on create (use whitelist endpoint)", async () => {
    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
        isWhitelisted: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(coworkerCreateMock).not.toHaveBeenCalled();
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
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
        vendorId,
      }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects create when name is shorter than 3 characters", async () => {
    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
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

  it("rejects create when vendorId is missing", async () => {
    const app = createApp({ userId: "admin_123", role: "admin" });
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Ops Agent",
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
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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

  it("updates coworker baseURL", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            baseURL: "https://responses.example.com/v1",
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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
        baseURL: "https://responses.example.com/v1",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseURL: "https://responses.example.com/v1",
        }),
      }),
    );
    expect(body.data.baseURL).toBe("https://responses.example.com/v1");
  });

  it("clears coworker baseURL when null is provided", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            baseURL: null,
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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
        baseURL: null,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseURL: null,
        }),
      }),
    );
    expect(body.data.baseURL).toBeNull();
  });

  it("updates coworker capabilities", async () => {
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            capabilities: ["chat", "tasks"],
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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
        capabilities: ["tasks", "chat", "tasks"],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capabilities: ["chat", "tasks"],
        }),
      }),
    );
    expect(body.data.capabilities).toEqual(["chat", "tasks"]);
  });

  it("updates coworker priority", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({
            priority: 10,
          }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
      role: "admin",
    });
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        priority: 10,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 10,
        }),
      }),
    );
    expect(body.data.priority).toBe(10);
  });

  it("rejects priority updates for non-admin owner", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/cow_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        priority: 10,
      }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("updates coworker metadata channels", async () => {
    const metadata = {
      channels: {
        email: "foo@bar.com",
        whatsapp: "+49151xxxx",
      },
    };
    const tx: TransactionMock = {
      coworker: {
        findUnique: coworkerFindUniqueMock,
        findFirst: coworkerFindFirstTxMock.mockResolvedValue(
          createCoworkerRecord({ metadata }),
        ),
        create: coworkerCreateMock,
        updateMany: coworkerUpdateManyMock.mockResolvedValue({ count: 1 }),
      },
      coworkerApiKey: {
        updateMany: coworkerApiKeyUpdateManyMock,
      },
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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
        metadata,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata,
        }),
      }),
    );
    expect(body.data.metadata).toEqual(metadata);
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
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
      role: "admin",
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
      vendor: {
        findUnique: vi.fn(),
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
      include: { vendor: true },
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
      vendor: {
        findUnique: vi.fn(),
      },
    };

    mockTransaction(tx);

    const app = createApp({
      userId: "admin_123",
      role: "admin",
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
      vendor: {
        findUnique: vendorFindUniqueMock.mockResolvedValue({ id: vendorId }),
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
