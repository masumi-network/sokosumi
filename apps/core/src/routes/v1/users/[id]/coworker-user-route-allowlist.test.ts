import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { agentUserRouteAllowlistMiddleware } from "@/routes/v1/users/user-coworker-route-allowlist";
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

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  buildCreditsPayloadMock,
  memberFindManyMock,
  resolveMemberOrganizationByIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  prismaTransactionMock,
  txUserFindUniqueMock,
  assertCoworkerUserContextBindingMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txUserFindUniqueMock: vi.fn(),
  assertCoworkerUserContextBindingMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: (...args: unknown[]) =>
    assertCoworkerUserContextBindingMock(...args),
  requireAuthorizedUserContext: vi.fn(),
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
  pushOptIn: false,
};

const BARE_COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

const CONTEXT_COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const ORCHESTRATOR: AuthenticationContext = {
  actor: "orchestrator",
  sokoBotId: "11111111-1111-7111-8111-111111111111",
  userId: "user_123",
  workspaceId: "22222222-2222-7222-8222-222222222222",
  organizationId: null,
};

function createUserRouteApp(
  authContext: AuthenticationContext,
): OpenAPIHonoWithAuth {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  userByIdApp.use("*", agentUserRouteAllowlistMiddleware);
  mountGetUserById(userByIdApp);
  mountGetUserCredits(userByIdApp);
  mountGetUserOrganizations(userByIdApp);
  mountGetUserOrganizationCredits(userByIdApp);
  mountGetUserOrganizationMember(userByIdApp);
  mountGetUserPreferences(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("coworker user route allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertCoworkerUserContextBindingMock.mockResolvedValue(undefined);
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

  it("allows an orchestrator to read its owner's allowlisted profile and credits", async () => {
    const app = createUserRouteApp(ORCHESTRATOR);

    expect((await app.request("http://localhost/me")).status).toBe(200);
    expect((await app.request("http://localhost/me/credits")).status).toBe(200);
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

  it("rejects an orchestrator on non-allowlisted owner settings", async () => {
    const app = createUserRouteApp(ORCHESTRATOR);
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
      pushOptIn: false,
    });
  });
});
