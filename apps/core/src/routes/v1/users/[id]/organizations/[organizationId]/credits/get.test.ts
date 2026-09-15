import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import usersRouter from "../../../../index";
import mountGetOrganizationCredits from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  assertCoworkerUserContextBindingMock,
  resolveMemberOrganizationByIdMock,
  buildCreditsPayloadMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  assertCoworkerUserContextBindingMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: (...args: unknown[]) =>
    assertCoworkerUserContextBindingMock(...args),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

vi.mock("@/helpers/subscription", () => ({
  buildCreditsPayload: (...args: unknown[]) => buildCreditsPayloadMock(...args),
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_a",
  role: "user",
};

/** A Serviceplan-style coworker key bound to Workspace A by context headers. */
const COWORKER_IN_ORG_A: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_serviceplan",
  context: { userId: "user_123", organizationId: "org_a" },
};

const COWORKER_IN_PERSONAL_WORKSPACE: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_serviceplan",
  context: { userId: "user_123", organizationId: null },
};

const SOKO_BOT_IN_ORG_A: AuthenticationContext = {
  actor: "sokoBot",
  sokoBotId: "bot_1",
  userId: "user_123",
  workspaceId: "workspace_a",
  organizationId: "org_a",
};

const CREDITS_PAYLOAD = {
  scope: "organization",
  spendable: 70,
  subscription: null,
  extra: {
    credits: { total: 25, remaining: 12.5, used: 12.5 },
    buckets: [],
    enterprise: null,
  },
  enterprise: null,
  credits: { subscription: null, buffer: 12.5, total: 70 },
};

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetOrganizationCredits(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function requestCredits(
  authContext: AuthenticationContext,
  organizationId: string,
) {
  return createApp(authContext).request(
    `http://localhost/me/organizations/${organizationId}/credits`,
  );
}

describe("users/{id}/organizations/{organizationId}/credits OpenAPI contract", () => {
  it("documents organization credits with nested subscription, buffer, and total payload", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const organizationCreditsResponses =
      doc.paths?.["/{id}/organizations/{organizationId}/credits"]?.get
        ?.responses;

    expect(organizationCreditsResponses).toBeDefined();
    expect(organizationCreditsResponses).toHaveProperty("200");
    expect(organizationCreditsResponses).toHaveProperty("401");
    expect(organizationCreditsResponses).toHaveProperty("403");
    expect(organizationCreditsResponses).toHaveProperty("404");
    expect(organizationCreditsResponses).toHaveProperty("500");

    const organizationCreditsContract = JSON.stringify(
      organizationCreditsResponses?.["200"],
    );

    expect(organizationCreditsContract).toContain("buffer");
    expect(organizationCreditsContract).toContain("total");
    expect(organizationCreditsContract).toContain("subscription");
  });
});

describe("GET /users/{id}/organizations/{organizationId}/credits organization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    assertCoworkerUserContextBindingMock.mockResolvedValue(undefined);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_a" },
    });
    buildCreditsPayloadMock.mockResolvedValue(CREDITS_PAYLOAD);
  });

  it("lets a session user read credits for any organization they belong to", async () => {
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_b" },
    });

    const response = await requestCredits(SESSION_USER, "org_b");

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the bound organization to a coworker", async () => {
    const response = await requestCredits(COWORKER_IN_ORG_A, "org_a");

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledTimes(1);
    expect(assertCoworkerUserContextBindingMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a coworker reading another organization the user belongs to", async () => {
    const response = await requestCredits(COWORKER_IN_ORG_A, "org_b");

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("refuses a Soko Bot key reading outside its workspace organization", async () => {
    const response = await requestCredits(SOKO_BOT_IN_ORG_A, "org_b");

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("refuses every organization for a personal workspace context", async () => {
    const response = await requestCredits(
      COWORKER_IN_PERSONAL_WORKSPACE,
      "org_a",
    );

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });
});
