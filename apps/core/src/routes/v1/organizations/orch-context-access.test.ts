import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGetOrganization from "./[id]/get";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get";
import mountGetOrganizationSubscription from "./[id]/subscription/get";
import mountGetOrganizationBySlug from "./slug/[slug]/get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

/**
 * Shared matrix: bare orch must fail requireUserContext; orch+ctx may pass
 * membership and reach the handler body. Uses real requireUserContext.
 */

const {
  resolveMemberOrganizationByIdMock,
  resolveMemberOrganizationBySlugMock,
  resolveActiveSubscriptionByReferenceIdMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  resolveMemberOrganizationBySlugMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/organization")>()),
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
  resolveMemberOrganizationBySlug: resolveMemberOrganizationBySlugMock,
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    subscriptionRepository: {
      ...actual.subscriptionRepository,
      resolveActiveSubscriptionByReferenceId:
        resolveActiveSubscriptionByReferenceIdMock,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const ORG = {
  id: "org_123",
  name: "Acme",
  slug: "acme",
  logo: null,
  metadata: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  stripeCustomerId: "cus_org_123",
};

const BARE_ORCH: AuthenticationContext = {
  actor: "orchestrator",
  orchestratorId: "orch_123",
};

const ORCH_CTX: AuthenticationContext = {
  actor: "orchestrator",
  orchestratorId: "orch_123",
  context: { userId: "user_123", organizationId: "org_123" },
};

function createApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthenticationContext,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_orch_org_matrix");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}

describe("organization routes: orchestrator context matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: ORG,
      role: "member",
      member: { role: "member" },
    });
    resolveMemberOrganizationBySlugMock.mockResolvedValue({
      organization: ORG,
      role: "member",
      member: { role: "member" },
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => await callback({}),
    );
  });

  const cases: Array<{
    name: string;
    mount: (app: OpenAPIHonoWithAuth) => void;
    path: string;
  }> = [
    {
      name: "GET /organizations/{id}",
      mount: mountGetOrganization,
      path: "/org_123",
    },
    {
      name: "GET /organizations/slug/{slug}",
      mount: mountGetOrganizationBySlug,
      path: "/slug/acme",
    },
    {
      name: "GET /organizations/{id}/subscription",
      mount: mountGetOrganizationSubscription,
      path: "/org_123/subscription",
    },
    {
      name: "GET /organizations/{id}/stripe-customer",
      mount: mountGetOrganizationStripeCustomer,
      path: "/org_123/stripe-customer",
    },
  ];

  for (const routeCase of cases) {
    describe(routeCase.name, () => {
      it("returns 403 for bare orchestrator without context headers", async () => {
        const response = await createApp(routeCase.mount, BARE_ORCH).request(
          `http://localhost${routeCase.path}`,
        );

        expect(response.status).toBe(403);
        expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
        expect(resolveMemberOrganizationBySlugMock).not.toHaveBeenCalled();
      });

      it("allows orchestrator with context headers as the context user", async () => {
        const response = await createApp(routeCase.mount, ORCH_CTX).request(
          `http://localhost${routeCase.path}`,
        );

        expect(response.status).toBe(200);
        const membershipCalled =
          resolveMemberOrganizationByIdMock.mock.calls.length > 0 ||
          resolveMemberOrganizationBySlugMock.mock.calls.length > 0;
        expect(membershipCalled).toBe(true);
        const membershipCall =
          resolveMemberOrganizationByIdMock.mock.calls[0] ??
          resolveMemberOrganizationBySlugMock.mock.calls[0];
        expect(membershipCall?.[0]).toEqual(
          expect.objectContaining({ userId: "user_123" }),
        );
      });
    });
  }
});
