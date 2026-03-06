import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPatchCoworkerWhitelistById from "./patch";

const {
  userFindUniqueMock,
  prismaTransactionMock,
  coworkerUpdateManyMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  coworkerUpdateManyMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
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
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
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

  mountPatchCoworkerWhitelistById(app as unknown as OpenAPIHonoWithAuth);

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
    caption: null,
    company: null,
    companyLogo: null,
    url: null,
    baseURL: null,
    email: "ops@example.com",
    description: null,
    image: null,
    userId: "user_123",
    ...overrides,
  };
}

describe("PATCH /coworkers/{id}/whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });
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

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
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

    expect(response.status).toBe(200);
    expect(coworkerUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      data: {
        isWhitelisted: false,
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
