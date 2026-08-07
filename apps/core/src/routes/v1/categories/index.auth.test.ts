import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authContextState,
  prismaTransactionMock,
  creditCostFindManyMock,
  categoryFindManyMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: null as {
      actor: "user";
      userId: string;
      organizationId: string | null;
      role: string;
    } | null,
  },
  prismaTransactionMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json({ error: "Unauthorized", message: "Unauthorized" }, 401);
      }
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    creditCost: {
      findMany: creditCostFindManyMock,
    },
    category: {
      findMany: categoryFindManyMock,
    },
  },
}));

const { default: categoriesRouter } = await import("./index");

describe("categories routes auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = null;
    creditCostFindManyMock.mockResolvedValue([{ unit: "default" }]);
    categoryFindManyMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(async (callback) => {
      const tx = {
        creditCost: { findMany: creditCostFindManyMock },
        syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
        category: { findMany: categoryFindManyMock },
      };
      return await callback(tx);
    });
  });

  it("allows anonymous GET /categories", async () => {
    const response = await categoriesRouter.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(categoryFindManyMock).toHaveBeenCalled();
  });
});
