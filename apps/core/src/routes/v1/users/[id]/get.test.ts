import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserById from "./get";

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
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

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

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserById(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
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
