import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostUtmAttribution from "./post";

const { createUTMAttributionMock, userFindUniqueMock } = vi.hoisted(() => ({
  createUTMAttributionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  utmAttributionRepository: {
    createUTMAttribution: createUTMAttributionMock,
  },
}));

const USER_ID = "user_123";
const ATTRIBUTION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONVERTED_AT = new Date("2026-02-20T09:05:00.000Z");
const CAPTURED_AT = "2026-02-20T08:00:00.000Z";

function validBody() {
  return {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring_launch",
    capturedAt: CAPTURED_AT,
  };
}

function createApp(actor: "user" | "coworker" | "unauthenticated" = "user") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

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

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostUtmAttribution(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);

  return app;
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("http://localhost/me/utm-attribution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /users/{id}/utm-attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    createUTMAttributionMock.mockResolvedValue({
      id: ATTRIBUTION_ID,
      convertedAt: CONVERTED_AT,
    });
  });

  it("records the attribution for the session user", async () => {
    const app = createApp();
    const response = await post(app, validBody());

    expect(response.status).toBe(200);
    expect(createUTMAttributionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring_launch",
        capturedAt: CAPTURED_AT,
      }),
      expect.anything(),
    );

    const body = await response.json();
    expect(body.data).toEqual({
      id: ATTRIBUTION_ID,
      convertedAt: CONVERTED_AT.toISOString(),
    });
  });

  it("returns 400 when utm_source is missing", async () => {
    const app = createApp();
    const response = await post(app, { capturedAt: CAPTURED_AT });

    expect(response.status).toBe(400);
    expect(createUTMAttributionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const app = createApp();
    const response = await post(app, validBody());

    expect(response.status).toBe(404);
    expect(createUTMAttributionMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker-authenticated requests", async () => {
    const app = createApp("coworker");
    const response = await post(app, validBody());

    expect(response.status).toBe(403);
    expect(createUTMAttributionMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const app = createApp("unauthenticated");
    const response = await post(app, validBody());

    expect(response.status).toBe(401);
    expect(createUTMAttributionMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the repository returns null", async () => {
    createUTMAttributionMock.mockResolvedValue(null);

    const app = createApp();
    const response = await post(app, validBody());

    expect(response.status).toBe(500);
  });
});
