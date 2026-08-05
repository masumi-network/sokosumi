import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { coworkerUserRouteAllowlistMiddleware } from "@/routes/v1/users/user-coworker-route-allowlist";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetUserCredits from "./credits/get.js";
import mountGetUserById from "./get.js";
import mountGetUserOrganizationCredits from "./organizations/[organizationId]/credits/get.js";
import mountGetUserOrganizationMember from "./organizations/[organizationId]/member/get.js";
import mountGetUserOrganizations from "./organizations/get.js";
import mountGetUserPreferences from "./preferences/get.js";

const {
  userFindUniqueMock,
  buildCreditsPayloadMock,
  memberFindManyMock,
  resolveMemberOrganizationByIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  prismaTransactionMock,
  txUserFindUniqueMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txUserFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/subscription", () => ({
  buildCreditsPayload: buildCreditsPayloadMock,
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

const CREDITS_PAYLOAD = {
  subscription: null,
  extra: {
    credits: { total: 10, remaining: 10, used: 0 },
    buckets: [],
    enterprise: null,
  },
  credits: {
    subscription: null,
    buffer: 10,
    total: 10,
  },
};

const MEMBER_RECORD = {
  id: "member_1",
  userId: "user_123",
  organizationId: "org_1",
  role: "member",
  seatAssignedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const USER_RECORD = {
  id: "user_123",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  role: "user",
  marketingOptIn: true,
  notificationsOptIn: false,
};

const BARE_COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  isDelegationApproved: true,
};

const CONTEXT_COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  isDelegationApproved: true,
  context: { userId: "user_123", organizationId: null },
};

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const CONTEXT_ORCHESTRATOR: AuthenticationContext = {
  actor: "orchestrator",
  orchestratorId: "orch_123",
  context: { userId: "user_123", organizationId: null },
};

function createUserRouteApp(
  authContext: AuthenticationContext,
): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  userByIdApp.use("*", coworkerUserRouteAllowlistMiddleware);
  mountGetUserById(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountGetUserCredits(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountGetUserOrganizations(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountGetUserOrganizationCredits(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountGetUserOrganizationMember(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountGetUserPreferences(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("coworker user route allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    buildCreditsPayloadMock.mockResolvedValue(CREDITS_PAYLOAD);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(MEMBER_RECORD);
    txUserFindUniqueMock.mockResolvedValue(USER_RECORD);
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          user: { findUnique: typeof txUserFindUniqueMock };
          member: { findMany: typeof memberFindManyMock };
        }) => Promise<unknown>,
      ) =>
        callback({
          user: { findUnique: txUserFindUniqueMock },
          member: { findMany: memberFindManyMock },
        }),
    );
    memberFindManyMock.mockResolvedValue([]);
  });

  it("returns 403 for bare coworker on credits", async () => {
    const app = createUserRouteApp(BARE_COWORKER);
    const response = await app.request("http://localhost/me/credits");
    expect(response.status).toBe(403);
  });

  it("allows coworker with context headers on user profile", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request("http://localhost/me");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("allows coworker with context headers on credits", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request("http://localhost/me/credits");
    expect(response.status).toBe(200);
    expect(buildCreditsPayloadMock).toHaveBeenCalled();
  });

  it("allows coworker with context headers on organizations list", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request("http://localhost/me/organizations");
    expect(response.status).toBe(200);
  });

  it("allows coworker with context headers on organization credits", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request(
      "http://localhost/me/organizations/org_1/credits",
    );
    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalled();
    expect(buildCreditsPayloadMock).toHaveBeenCalled();
  });

  it("rejects coworker with context headers on organization member", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request(
      "http://localhost/me/organizations/org_1/member",
    );
    expect(response.status).toBe(403);
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("rejects coworker with context headers on preferences", async () => {
    const app = createUserRouteApp(CONTEXT_COWORKER);
    const response = await app.request("http://localhost/me/preferences");
    expect(response.status).toBe(403);
  });

  it("lets session users reach non-allowlisted preferences", async () => {
    const app = createUserRouteApp(SESSION_USER);
    const response = await app.request("http://localhost/me/preferences");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      marketingOptIn: true,
      notificationsOptIn: false,
    });
  });

  it("lets orchestrator with context reach non-allowlisted preferences", async () => {
    const app = createUserRouteApp(CONTEXT_ORCHESTRATOR);
    const response = await app.request("http://localhost/me/preferences");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      marketingOptIn: true,
      notificationsOptIn: false,
    });
  });
});
