import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

import mountCredits from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { buildCreditsPayloadMock, workspaceFindUniqueMock } = vi.hoisted(() => ({
  buildCreditsPayloadMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/credits/funding", () => ({
  buildCreditsPayload: buildCreditsPayloadMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(async () => ({ id: "user_123" })) },
    member: { findUnique: vi.fn(async () => ({ id: "member_1" })) },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

const PAYLOAD = {
  scope: "personal",
  spendable: 0,
  enterprise: null,
  subscription: null,
  extra: {
    credits: { total: 0, remaining: 0, used: 0 },
    buckets: [],
    enterprise: null,
  },
  credits: { subscription: null, buffer: 0, total: 0 },
};

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  const byId = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(byId);
  mountCredits(byId);
  app.route("/:id", byId);
  return app;
}

const PERSON: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "oauth",
};

describe("GET /users/{id}/credits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildCreditsPayloadMock.mockResolvedValue(PAYLOAD);
  });

  // SOKD-473: a person with only an org workspace was told "personal: 0 credits".
  it("asks for a workspace when the person has no personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);

    const response = await createApp(PERSON).request("/me/credits");

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toContain("no personal workspace");
    expect(body.message).toContain("X-Organization-Slug");
    expect(buildCreditsPayloadMock).not.toHaveBeenCalled();
  });

  it("reports the personal balance when the personal workspace exists", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_personal" });

    const response = await createApp(PERSON).request("/me/credits");

    expect(response.status).toBe(200);
    expect(buildCreditsPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        referenceId: "user_123",
      }),
    );
  });

  it("reads an organization's balance without looking for a personal workspace", async () => {
    const response = await createApp({
      ...PERSON,
      organizationId: "org_1",
    }).request("/me/credits");

    expect(response.status).toBe(200);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });
});
