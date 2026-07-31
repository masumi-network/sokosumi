import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { coworkerUserRouteAllowlistMiddleware } from "@/routes/v1/users/user-coworker-route-allowlist";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetUserCredits from "./credits/get.js";
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
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    $transaction: async (
      callback: (tx: {
        member: { findMany: typeof memberFindManyMock };
      }) => Promise<unknown>,
    ) =>
      callback({
        member: { findMany: memberFindManyMock },
      }),
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

function createCoworkerUserApp(options: {
  withContext: boolean;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set(
      "authContext",
      options.withContext
        ? {
            actor: "coworker",
            coworkerId: "cow_123",
            vendorId: TEST_VENDOR_ID,
            context: { userId: "user_123", organizationId: null },
          }
        : {
            actor: "coworker",
            coworkerId: "cow_123",
            vendorId: TEST_VENDOR_ID,
          },
    );
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  userByIdApp.use("*", coworkerUserRouteAllowlistMiddleware);
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
    memberFindManyMock.mockResolvedValue([]);
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(MEMBER_RECORD);
  });

  it("returns 403 for bare coworker on credits", async () => {
    const app = createCoworkerUserApp({ withContext: false });
    const response = await app.request("http://localhost/me/credits");
    expect(response.status).toBe(403);
  });

  it("allows coworker with context headers on credits", async () => {
    const app = createCoworkerUserApp({ withContext: true });
    const response = await app.request("http://localhost/me/credits");
    expect(response.status).toBe(200);
    expect(buildCreditsPayloadMock).toHaveBeenCalled();
  });

  it("allows coworker with context headers on organizations list", async () => {
    const app = createCoworkerUserApp({ withContext: true });
    const response = await app.request("http://localhost/me/organizations");
    expect(response.status).toBe(200);
  });

  it("allows coworker with context headers on organization credits", async () => {
    const app = createCoworkerUserApp({ withContext: true });
    const response = await app.request(
      "http://localhost/me/organizations/org_1/credits",
    );
    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalled();
    expect(buildCreditsPayloadMock).toHaveBeenCalled();
  });

  it("rejects coworker with context headers on organization member", async () => {
    const app = createCoworkerUserApp({ withContext: true });
    const response = await app.request(
      "http://localhost/me/organizations/org_1/member",
    );
    expect(response.status).toBe(403);
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("rejects coworker with context headers on preferences", async () => {
    const app = createCoworkerUserApp({ withContext: true });
    const response = await app.request("http://localhost/me/preferences");
    expect(response.status).toBe(403);
  });
});
