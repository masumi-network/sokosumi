import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import usersRouter from "./index";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "user_1" }) },
  },
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      ...actual.workspaceRepository,
      resolveWorkspaceForContext: vi
        .fn()
        .mockRejectedValue(new actual.PersonalWorkspaceMissingError()),
    },
  };
});

describe("users routes for coworkers", () => {
  it("answers 403 for a route outside the coworker list before resolving the context workspace", async () => {
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "user_1", organizationId: null },
      });
      await next();
    });
    app.route("/users", usersRouter);

    const response = await app.request("http://localhost/users/me/workspaces");

    expect(response.status).toBe(403);
  });
});

describe("users routes OpenAPI contract", () => {
  it("mounts the registered lookup at /registered without a duplicated segment", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/registered"]?.get).toBeDefined();
    expect(doc.paths?.["/registered/registered"]?.get).toBeUndefined();
  });

  it("returns 404 for /{id} routes when the target user does not exist", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/files"]?.post?.responses).toHaveProperty("404");
    expect(doc.paths?.["/{id}/files"]?.get?.responses).toHaveProperty("404");
    expect(doc.paths?.["/{id}/preferences"]?.get?.responses).toHaveProperty(
      "404",
    );
    expect(doc.paths?.["/{id}/organizations"]?.get?.responses).toHaveProperty(
      "404",
    );
  });

  it("does not expose a bare organization-by-id details endpoint (only list and org credits)", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/organizations"]?.get).toBeDefined();
    expect(
      doc.paths?.["/{id}/organizations/{organizationId}"]?.get,
    ).toBeUndefined();
    expect(
      doc.paths?.["/{id}/organizations/{organizationId}/credits"]?.get,
    ).toBeDefined();
  });

  it("does not mount GET/POST /{id}/onboarding (onboardingCompleted retired)", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/onboarding"]?.get).toBeUndefined();
    expect(doc.paths?.["/{id}/onboarding"]?.post).toBeUndefined();
  });

  it("exposes GET /{id}/deletion for the signed-in user", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const getOperation = doc.paths?.["/{id}/deletion"]?.get;
    expect(getOperation).toBeDefined();
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("401");
    expect(getOperation?.responses).toHaveProperty("403");
  });
});
