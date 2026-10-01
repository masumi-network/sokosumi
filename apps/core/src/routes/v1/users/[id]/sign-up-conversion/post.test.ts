import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostSignUpConversion from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, verificationFindFirstMock, deleteManyMock } =
  vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    verificationFindFirstMock: vi.fn(),
    deleteManyMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    verification: {
      findFirst: verificationFindFirstMock,
      deleteMany: deleteManyMock,
    },
  },
}));

const USER_ID = "user_123";

function createApp(actor: "user" | "coworker" | "unauthenticated" = "user") {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    if (actor === "unauthenticated") {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("isAuthenticated", true);
    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: USER_ID,
        organizationId: null,
        role: "user",
      });
    }

    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostSignUpConversion(userByIdApp);
  app.route("/:id", userByIdApp);

  return app;
}

function claim(app: ReturnType<typeof createApp>) {
  return app.request("http://localhost/me/sign-up-conversion", {
    method: "POST",
  });
}

describe("POST /users/{id}/sign-up-conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    verificationFindFirstMock.mockResolvedValue(null);
    deleteManyMock.mockResolvedValue({ count: 1 });
  });

  it("hands the pending social sign-up's provider to the first claim", async () => {
    verificationFindFirstMock.mockResolvedValue({
      id: "row-1",
      value: "google",
    });
    const app = createApp();

    const response = await claim(app);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ provider: "google" });
    expect(verificationFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          identifier: `sign-up-conversion:${USER_ID}`,
        }),
      }),
    );
  });

  it("answers no provider when nothing is pending", async () => {
    const app = createApp();

    const response = await claim(app);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ provider: null });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker-authenticated requests", async () => {
    const response = await claim(createApp("coworker"));

    expect(response.status).toBe(403);
    expect(verificationFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const response = await claim(createApp("unauthenticated"));

    expect(response.status).toBe(401);
    expect(verificationFindFirstMock).not.toHaveBeenCalled();
  });
});
