import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
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
  userByIdApp.use("*", usersPathUserContextMiddleware);
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
});
