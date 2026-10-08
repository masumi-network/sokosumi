import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

import mountGetUserById from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { pathUserFindUniqueMock, prismaTransactionMock, txUserFindUniqueMock } =
  vi.hoisted(() => ({
    pathUserFindUniqueMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
    txUserFindUniqueMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: pathUserFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "admin",
    });

    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(userByIdApp);
  mountGetUserById(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        user: {
          findUnique: txUserFindUniqueMock,
        },
      });
    });
  });

  it("returns 404 when the target user is missing", async () => {
    pathUserFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/missing_user");

    expect(response.status).toBe(404);
    expect(pathUserFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "missing_user" },
      select: { id: true },
    });
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(txUserFindUniqueMock).not.toHaveBeenCalled();
  });

  it.each([
    { firstName: "Ada", lastName: "Lovelace" },
    // Users from before the name parts, or created by an email code sent without names.
    { firstName: null, lastName: null },
  ])(
    "returns the session user's name parts $firstName $lastName",
    async (parts) => {
      pathUserFindUniqueMock.mockResolvedValue({
        id: "user_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        role: "user",
        ...parts,
      });
      const app = createApp();

      const response = await app.request("http://localhost/me");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Record<string, unknown> };
      expect(body.data).toMatchObject({ name: "Ada", ...parts });
    },
  );
});
