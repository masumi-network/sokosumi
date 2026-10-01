import {
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
} from "@sokosumi/database";
import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
  EnterpriseContractNotFoundError,
} from "@sokosumi/database/helpers";
import { convertCreditsToCents } from "@sokosumi/utils";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountActivateEnterpriseContract from "./[id]/activate/post.js";
import mountCancelEnterpriseContract from "./[id]/cancel/post.js";
import mountGetEnterpriseContractById from "./[id]/get.js";
import mountPatchEnterpriseContract from "./[id]/patch.js";
import mountPreviewEnterpriseContractPeriods from "./[id]/periods/preview/get.js";
import mountGetEnterpriseContracts from "./get.js";
import mountPostEnterpriseContract from "./post.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const CONTRACT_ID = "01960000-0000-7000-8000-000000000001";
const ORG_ID = "org_123";
const ORG_SLUG = "acme-corp";

const {
  organizationFindUniqueMock,
  enterpriseContractFindManyMock,
  enterpriseContractFindUniqueMock,
  txContractFindUniqueMock,
  enterpriseContractCreateMock,
  enterpriseContractUpdateMock,
  enterpriseContractPeriodUpdateManyMock,
  prismaTransactionMock,
  activateEnterpriseContractMock,
  cancelEnterpriseContractMock,
  previewEnterpriseContractPeriodsMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  enterpriseContractFindManyMock: vi.fn(),
  enterpriseContractFindUniqueMock: vi.fn(),
  txContractFindUniqueMock: vi.fn(),
  enterpriseContractCreateMock: vi.fn(),
  enterpriseContractUpdateMock: vi.fn(),
  enterpriseContractPeriodUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  activateEnterpriseContractMock: vi.fn(),
  cancelEnterpriseContractMock: vi.fn(),
  previewEnterpriseContractPeriodsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    enterpriseContract: {
      findMany: enterpriseContractFindManyMock,
      findUnique: enterpriseContractFindUniqueMock,
      create: enterpriseContractCreateMock,
      update: enterpriseContractUpdateMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    activateEnterpriseContract: activateEnterpriseContractMock,
    cancelEnterpriseContract: cancelEnterpriseContractMock,
    previewEnterpriseContractPeriods: previewEnterpriseContractPeriodsMock,
  };
});

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createContractRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CONTRACT_ID,
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    organizationId: ORG_ID,
    organization: { slug: ORG_SLUG },
    status: EnterpriseContractStatus.draft,
    periodCount: 12,
    activatedAt: null,
    canceledAt: null,
    seats: 10,
    centsPerMonth: convertCreditsToCents(60_000),
    oneTimeCents: null,
    oneTimeExpiresAt: null,
    paymentReference: null,
    notes: null,
    externalReference: null,
    periods: [],
    ...overrides,
  };
}

function mountContractRoutes(app: OpenAPIHonoWithAuth) {
  mountGetEnterpriseContracts(app);
  mountPostEnterpriseContract(app);
  mountPreviewEnterpriseContractPeriods(app);
  mountGetEnterpriseContractById(app);
  mountPatchEnterpriseContract(app);
  mountActivateEnterpriseContract(app);
  mountCancelEnterpriseContract(app);
}

function createContractsApp(options: AppOptions = {}) {
  const { role = "admin", actor = "user" } = options;
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_enterprise_test");
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
        userId: "user_admin",
        organizationId: null,
        role,
      });
    }

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountContractRoutes(app);

  return app;
}

describe("enterprise contract admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindUniqueMock.mockResolvedValue({
      id: ORG_ID,
      slug: ORG_SLUG,
    });
    enterpriseContractFindManyMock.mockResolvedValue([]);
    enterpriseContractFindUniqueMock.mockResolvedValue(null);
    txContractFindUniqueMock.mockImplementation(
      enterpriseContractFindUniqueMock,
    );
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        enterpriseContract: {
          findUnique: txContractFindUniqueMock,
          update: enterpriseContractUpdateMock,
        },
        enterpriseContractPeriod: {
          updateMany: enterpriseContractPeriodUpdateManyMock,
        },
      });
    });
    activateEnterpriseContractMock.mockResolvedValue({
      contractId: CONTRACT_ID,
      periodBucketCreated: true,
      periodsCreated: 12,
      topUpBucketCreated: false,
    });
    cancelEnterpriseContractMock.mockResolvedValue(undefined);
    previewEnterpriseContractPeriodsMock.mockReturnValue([
      {
        centsToGrant: convertCreditsToCents(60_000),
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-01T00:00:00.000Z"),
        purchasedSeats: 10,
      },
    ]);
  });

  describe("admin access", () => {
    it("returns 403 for non-admin users", async () => {
      const app = createContractsApp({ role: "user" });
      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: ORG_SLUG,
          creditsPerMonth: 60_000,
          periods: 12,
          seats: 10,
        }),
      });

      expect(response.status).toBe(403);
      expect(enterpriseContractCreateMock).not.toHaveBeenCalled();
    });

    it("returns 403 for coworker auth", async () => {
      const app = createContractsApp({ actor: "coworker" });
      const response = await app.request("http://localhost/");

      expect(response.status).toBe(403);
    });
  });

  describe("POST /", () => {
    it("creates a draft enterprise contract", async () => {
      const record = createContractRecord();
      enterpriseContractCreateMock.mockResolvedValue(record);
      const app = createContractsApp();

      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: ORG_SLUG,
          creditsPerMonth: 60_000,
          periods: 12,
          seats: 10,
        }),
      });

      const body = (await response.json()) as {
        data: { organizationSlug: string; status: string };
      };

      expect(response.status).toBe(201);
      expect(body.data.organizationSlug).toBe(ORG_SLUG);
      expect(body.data.status).toBe(EnterpriseContractStatus.draft);
      expect(enterpriseContractCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            status: EnterpriseContractStatus.draft,
            periodCount: 12,
          }),
          include: {
            organization: {
              select: { slug: true },
            },
          },
        }),
      );
    });

    it("returns 404 when the organization does not exist", async () => {
      organizationFindUniqueMock.mockResolvedValue(null);
      const app = createContractsApp();

      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: ORG_SLUG,
          creditsPerMonth: 60_000,
          periods: 12,
          seats: 10,
        }),
      });

      expect(response.status).toBe(404);
    });

    it("returns 422 when creditsPerMonth is below the minimum at validation", async () => {
      const app = createContractsApp();

      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: ORG_SLUG,
          creditsPerMonth: 1,
          periods: 12,
          seats: 10,
        }),
      });

      expect(response.status).toBe(422);
      expect(enterpriseContractCreateMock).not.toHaveBeenCalled();
    });

    it("creates a draft when one-time credits are set without expiry", async () => {
      const record = createContractRecord({
        oneTimeCents: convertCreditsToCents(5_000),
        oneTimeExpiresAt: null,
      });
      enterpriseContractCreateMock.mockResolvedValue(record);
      const app = createContractsApp();

      const response = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationSlug: ORG_SLUG,
          creditsPerMonth: 60_000,
          periods: 12,
          seats: 10,
          oneTimeCredits: 5_000,
        }),
      });

      expect(response.status).toBe(201);
      expect(enterpriseContractCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oneTimeCents: convertCreditsToCents(5_000),
            oneTimeExpiresAt: undefined,
          }),
        }),
      );
    });
  });

  describe("GET /", () => {
    it("lists contracts with optional filters", async () => {
      const record = createContractRecord();
      enterpriseContractFindManyMock.mockResolvedValue([record]);
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/?organizationSlug=${ORG_SLUG}&status=${EnterpriseContractStatus.draft}`,
      );
      const body = (await response.json()) as {
        data: Array<{ id: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(enterpriseContractFindManyMock).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          status: EnterpriseContractStatus.draft,
        },
        include: {
          organization: {
            select: { slug: true },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      });
    });
  });

  describe("GET /{id}", () => {
    it("returns 404 when the contract does not exist", async () => {
      const app = createContractsApp();
      const response = await app.request(`http://localhost/${CONTRACT_ID}`);

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /{id}", () => {
    it.each([
      {},
      { creditsPerMonth: 100_000, periods: 1 },
      { creditsPerMonth: 100_000, oneTimeCredits: 0 },
      { creditsPerMonth: 100_000, oneTimeCredits: null },
      { creditsPerMonth: 100_000, oneTimeExpiresAt: null },
      { creditsPerMonth: 100_000, paymentReference: null },
      { creditsPerMonth: 100_000, notes: "" },
      { creditsPerMonth: 100_000, externalReference: null },
    ])("rejects forbidden active payload %j without writes", async (body) => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      const response = await createContractsApp().request(
        `http://localhost/${CONTRACT_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(409);
      expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
      expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
    });

    it("keeps draft updates and nullable clearing on the existing path", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord(),
      );
      enterpriseContractUpdateMock.mockResolvedValue(createContractRecord());
      const response = await createContractsApp().request(
        `http://localhost/${CONTRACT_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creditsPerMonth: 60_000,
            periods: 3,
            seats: 5,
            oneTimeCredits: null,
            oneTimeExpiresAt: null,
            paymentReference: null,
            notes: "",
            externalReference: null,
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(enterpriseContractUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            centsPerMonth: 600_000_000_000_000n,
            periodCount: 3,
            seats: 5,
            oneTimeCents: null,
            oneTimeExpiresAt: null,
            paymentReference: null,
            notes: "",
            externalReference: null,
          },
        }),
      );
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
    });

    it("rejects a non-admin monthly credit update before reading or writing", async () => {
      const response = await createContractsApp({ role: "user" }).request(
        `http://localhost/${CONTRACT_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creditsPerMonth: 100_000 }),
        },
      );
      expect(response.status).toBe(403);
      expect(enterpriseContractFindUniqueMock).not.toHaveBeenCalled();
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it("rechecks status when a credit transaction loses a serialization race", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      txContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.canceled }),
      );
      prismaTransactionMock.mockRejectedValueOnce(
        Object.assign(new Error("Concurrent cancellation"), { code: "P2034" }),
      );
      vi.useFakeTimers();
      try {
        const pending = createContractsApp().request(
          `http://localhost/${CONTRACT_ID}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creditsPerMonth: 100_000 }),
          },
        );
        await vi.runAllTimersAsync();
        const response = await pending;
        expect(response.status).toBe(409);
        expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
        expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
        expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects an active contract payload containing an unknown field without writes", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      enterpriseContractUpdateMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      const response = await createContractsApp().request(
        `http://localhost/${CONTRACT_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creditsPerMonth: 100_000,
            organizationSlug: "other-org",
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
      expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
    });

    it.each([
      EnterpriseContractStatus.canceled,
      EnterpriseContractStatus.completed,
    ])(
      "rejects a contract that becomes %s before the credit transaction starts",
      async (status) => {
        enterpriseContractFindUniqueMock.mockResolvedValue(
          createContractRecord({ status: EnterpriseContractStatus.active }),
        );
        txContractFindUniqueMock.mockResolvedValue(
          createContractRecord({ status }),
        );
        enterpriseContractUpdateMock.mockResolvedValue(
          createContractRecord({ status }),
        );
        const response = await createContractsApp().request(
          `http://localhost/${CONTRACT_ID}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creditsPerMonth: 100_000 }),
          },
        );

        expect(response.status).toBe(409);
        expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
        expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
      },
    );

    it("returns 409 when updating a non-draft contract", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      const app = createContractsApp();

      const response = await app.request(`http://localhost/${CONTRACT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: 20 }),
      });

      expect(response.status).toBe(409);
      expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
    });

    it("changes credits per month on an active contract and its ungranted periods", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      enterpriseContractUpdateMock.mockResolvedValue(
        createContractRecord({
          status: EnterpriseContractStatus.active,
          centsPerMonth: convertCreditsToCents(100_000),
        }),
      );
      const app = createContractsApp();

      const response = await app.request(`http://localhost/${CONTRACT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditsPerMonth: 100_000 }),
      });

      const body = (await response.json()) as {
        data: { creditsPerMonth: number };
      };

      expect(response.status).toBe(200);
      expect(body.data.creditsPerMonth).toBe(100_000);
      expect(prismaTransactionMock.mock.calls[0]?.[1]).toEqual({
        isolationLevel: "Serializable",
      });
      expect(enterpriseContractUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONTRACT_ID },
          data: { centsPerMonth: convertCreditsToCents(100_000) },
        }),
      );
      expect(enterpriseContractPeriodUpdateManyMock).toHaveBeenCalledWith({
        where: {
          contractId: CONTRACT_ID,
          status: EnterpriseContractPeriodStatus.scheduled,
        },
        data: { centsToGrant: convertCreditsToCents(100_000) },
      });
    });

    it("returns 409 when an active contract update changes more than credits per month", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      const app = createContractsApp();

      const response = await app.request(`http://localhost/${CONTRACT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditsPerMonth: 100_000, seats: 20 }),
      });

      expect(response.status).toBe(409);
      expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
      expect(enterpriseContractPeriodUpdateManyMock).not.toHaveBeenCalled();
    });

    it("returns 409 when updating a canceled contract", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.canceled }),
      );
      const app = createContractsApp();

      const response = await app.request(`http://localhost/${CONTRACT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditsPerMonth: 100_000 }),
      });

      expect(response.status).toBe(409);
      expect(enterpriseContractUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /{id}/periods/preview", () => {
    it("returns 409 when previewing a non-draft contract", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord({ status: EnterpriseContractStatus.active }),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/periods/preview?activatedAt=2026-06-15T00:00:00.000Z`,
      );

      expect(response.status).toBe(409);
      expect(previewEnterpriseContractPeriodsMock).not.toHaveBeenCalled();
    });

    it("returns 422 when activatedAt is not a valid datetime", async () => {
      enterpriseContractFindUniqueMock.mockResolvedValue(
        createContractRecord(),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/periods/preview?activatedAt=not-a-date`,
      );

      expect(response.status).toBe(422);
      expect(previewEnterpriseContractPeriodsMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /{id}/activate", () => {
    it("activates a draft contract with an empty JSON body", async () => {
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const body = (await response.json()) as {
        data: { contractId: string; periodsCreated: number };
      };

      expect(response.status).toBe(200);
      expect(body.data.contractId).toBe(CONTRACT_ID);
      expect(activateEnterpriseContractMock).toHaveBeenCalledWith(
        CONTRACT_ID,
        expect.objectContaining({
          paymentReference: undefined,
          activatedAt: expect.any(Date),
        }),
        expect.anything(),
      );
    });

    it("activates in a serializable transaction", async () => {
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      // Activation auto-assigns seats, and Postgres only aborts a
      // serialization anomaly when both sides run at this level (SOK-1007).
      expect(response.status).toBe(200);
      expect(prismaTransactionMock.mock.calls).toHaveLength(1);
      expect(prismaTransactionMock.mock.calls[0]?.[1]).toEqual({
        isolationLevel: "Serializable",
      });
    });

    it("returns 409 when activation keeps losing the serialization race", async () => {
      prismaTransactionMock.mockRejectedValue(
        Object.assign(new Error("Transaction failed"), { code: "P2034" }),
      );
      vi.useFakeTimers();
      try {
        const app = createContractsApp();
        const pending = app.request(
          `http://localhost/${CONTRACT_ID}/activate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        await vi.runAllTimersAsync();
        const response = await pending;

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          kind: "concurrency_conflict",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns 404 when activation fails with a not-found lifecycle error", async () => {
      activateEnterpriseContractMock.mockRejectedValue(
        new EnterpriseContractNotFoundError(),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(404);
    });

    it("returns 409 with blocker and kind when activation is blocked", async () => {
      activateEnterpriseContractMock.mockRejectedValue(
        new EnterpriseContractActivationError({
          plan: "starter",
          referenceId: ORG_ID,
          scope: "organization",
          stripeSubscriptionId: "sub_stripe_1",
          subscriptionId: "sub_local_1",
        }),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const body = (await response.json()) as {
        kind: string;
        blocker: { subscriptionId: string };
      };

      expect(response.status).toBe(409);
      expect(body.kind).toBe("enterprise_activation_blocked");
      expect(body.blocker).toEqual({
        plan: "starter",
        scope: "organization",
        stripeSubscriptionId: "sub_stripe_1",
        subscriptionId: "sub_local_1",
      });
    });

    it("returns 409 for other lifecycle conflicts", async () => {
      activateEnterpriseContractMock.mockRejectedValue(
        new EnterpriseContractLifecycleError(
          "Only draft enterprise contracts can be activated",
        ),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(409);
    });
  });

  describe("POST /{id}/cancel", () => {
    it("returns 409 when canceling a non-active contract", async () => {
      cancelEnterpriseContractMock.mockRejectedValue(
        new EnterpriseContractLifecycleError(
          "Only active enterprise contracts can be canceled",
        ),
      );
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/cancel`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
    });

    it("returns the canceled contract", async () => {
      const canceled = createContractRecord({
        status: EnterpriseContractStatus.canceled,
        canceledAt: new Date("2026-06-02T10:00:00.000Z"),
      });
      enterpriseContractFindUniqueMock.mockResolvedValue(canceled);
      const app = createContractsApp();

      const response = await app.request(
        `http://localhost/${CONTRACT_ID}/cancel`,
        { method: "POST" },
      );

      const body = (await response.json()) as {
        data: { status: string };
      };

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(EnterpriseContractStatus.canceled);
    });
  });
});
