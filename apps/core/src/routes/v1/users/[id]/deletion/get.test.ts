import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, evaluateUserDeletionMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  evaluateUserDeletionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: vi.fn(),
}));

vi.mock("@/helpers/deletion-evaluate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/deletion-evaluate")>();
  return {
    ...actual,
    evaluateUserDeletion: (...args: unknown[]) =>
      evaluateUserDeletionMock(...args),
  };
});

const { default: mountGetUserDeletion } = await import("./get");

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserDeletion(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    evaluateUserDeletionMock.mockResolvedValue({
      blockers: [],
      reviewRequiredClaim: null,
    });
  });

  it("returns evaluate blockers for the signed-in user via `me`", async () => {
    evaluateUserDeletionMock.mockResolvedValue({
      blockers: [
        "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
        "TASK_PAYMENT_CLAIM_PENDING",
      ],
      reviewRequiredClaim: {
        id: "claim_review",
        reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
      },
    });

    const response = await createApp().request("http://localhost/me/deletion");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      blockers: [
        "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
        "TASK_PAYMENT_CLAIM_PENDING",
      ],
    });
    expect(evaluateUserDeletionMock).toHaveBeenCalledWith(
      "user_123",
      expect.anything(),
    );
  });

  it("returns an empty blocker list when evaluate allows deletion", async () => {
    const response = await createApp().request(
      "http://localhost/user_123/deletion",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ blockers: [] });
  });

  it("returns 403 when the caller is not the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/deletion",
    );

    expect(response.status).toBe(403);
    expect(evaluateUserDeletionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when a platform admin evaluates another user", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "other_user" });

    const response = await createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "admin",
    }).request("http://localhost/other_user/deletion");

    expect(response.status).toBe(403);
    expect(evaluateUserDeletionMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: null },
    }).request("http://localhost/me/deletion");

    expect(response.status).toBe(403);
    expect(evaluateUserDeletionMock).not.toHaveBeenCalled();
  });
});
