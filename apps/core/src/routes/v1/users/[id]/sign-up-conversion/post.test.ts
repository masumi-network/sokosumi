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

const {
  userFindUniqueMock,
  verificationFindFirstMock,
  deleteManyMock,
  upsertMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  verificationFindFirstMock: vi.fn(),
  deleteManyMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        uTMAttribution: { upsert: upsertMock },
        verification: {
          findFirst: verificationFindFirstMock,
          deleteMany: deleteManyMock,
        },
      }),
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

function createApp(
  actor:
    | "user"
    | "admin"
    | "oauth"
    | "api_key"
    | "coworker"
    | "unauthenticated" = "user",
) {
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
        role: actor === "admin" ? "admin" : "user",
        authenticationMethod:
          actor === "oauth" || actor === "api_key" ? actor : "session",
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

  it("rejects an admin claiming another user's conversion", async () => {
    const response = await createApp("admin").request(
      "http://localhost/other-user/sign-up-conversion",
      { method: "POST" },
    );
    expect(response.status).toBe(403);
    expect(verificationFindFirstMock).not.toHaveBeenCalled();
  });

  it.each(["oauth", "api_key"] as const)(
    "rejects %s credentials",
    async (actor) => {
      const response = await claim(createApp(actor));
      expect(response.status).toBe(403);
      expect(verificationFindFirstMock).not.toHaveBeenCalled();
    },
  );

  it("validates the UTM request before consuming a conversion", async () => {
    const response = await createApp().request(
      "http://localhost/me/sign-up-conversion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          utmAttribution: { utm_source: "ad", capturedAt: "not-a-date" },
        }),
      },
    );
    expect(response.status).toBe(422);
    expect(verificationFindFirstMock).not.toHaveBeenCalled();
  });

  it("records supplied UTM data for the authenticated session user", async () => {
    verificationFindFirstMock.mockResolvedValue({
      id: "row-1",
      value: "google",
    });
    const response = await createApp().request(
      "http://localhost/me/sign-up-conversion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          utmAttribution: {
            utm_source: "owned-ad",
            capturedAt: "2026-10-01T12:00:00.000Z",
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        create: expect.objectContaining({ utmSource: "owned-ad" }),
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
