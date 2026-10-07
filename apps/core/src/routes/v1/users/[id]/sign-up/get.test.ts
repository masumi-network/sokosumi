import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import usersRouter from "../../index";
import mountGetSignUp from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, signUpContextFindUniqueMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  signUpContextFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    signUpContext: { findUnique: signUpContextFindUniqueMock },
  },
}));

const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const CREATED_AT = new Date("2026-10-07T09:05:00.000Z");

function createApp(actor: "user" | "admin" | "unauthenticated" = "user") {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    if (actor === "unauthenticated") {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: actor,
    });
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetSignUp(userByIdApp);
  app.route("/:id", userByIdApp);

  return app;
}

function get(app: ReturnType<typeof createApp>, id: string) {
  return app.request(`http://localhost/${id}/sign-up`);
}

describe("GET /users/{id}/sign-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({ id: where.id }),
    );
    signUpContextFindUniqueMock.mockImplementation(
      async ({ where }: { where: { userId: string } }) => ({
        userId: where.userId,
        origin: "cmo",
        entries: {},
        clientId: "cmo-client",
        createdAt: CREATED_AT,
      }),
    );
  });

  it("returns the person's own sign-up, without the OAuth client", async () => {
    const response = await get(createApp(), "me");

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      origin: "cmo",
      context: {},
      createdAt: CREATED_AT.toISOString(),
    });
    expect(signUpContextFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
  });

  it("lets an admin read another user's sign-up", async () => {
    const response = await get(createApp("admin"), OTHER_USER_ID);

    expect(response.status).toBe(200);
    expect(signUpContextFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OTHER_USER_ID } }),
    );
  });

  it("refuses another user", async () => {
    const response = await get(createApp(), OTHER_USER_ID);

    expect(response.status).toBe(403);
    expect(signUpContextFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an account without a recorded sign-up", async () => {
    signUpContextFindUniqueMock.mockResolvedValue(null);

    const response = await get(createApp(), "me");

    expect(response.status).toBe(404);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const response = await get(createApp("unauthenticated"), "me");

    expect(response.status).toBe(401);
  });

  it("documents origin, context and createdAt in the OpenAPI response", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Users API", version: "1.0.0" },
    });

    expect(doc.paths?.["/{id}/sign-up"]?.get).toBeDefined();
    const schema = doc.components?.schemas?.SignUpContext;
    expect(schema).toMatchObject({
      required: expect.arrayContaining(["origin", "context", "createdAt"]),
    });
    expect(
      Object.keys(
        schema && "properties" in schema ? (schema.properties ?? {}) : {},
      ).sort(),
    ).toEqual(["context", "createdAt", "origin"]);
  });
});
