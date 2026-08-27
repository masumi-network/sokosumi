import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  actionGroupByMock,
  paymentCountMock,
  paymentFindManyMock,
  paymentGroupByMock,
  prismaTransactionMock,
  refundVerifiedMock,
  resolvePendingMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
      authenticationMethod: "session",
    } as AuthenticationContext,
  },
  actionGroupByMock: vi.fn(),
  paymentCountMock: vi.fn(),
  paymentFindManyMock: vi.fn(),
  paymentGroupByMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  refundVerifiedMock: vi.fn(),
  resolvePendingMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskX402Payment: {
      findMany: paymentFindManyMock,
      count: paymentCountMock,
      groupBy: paymentGroupByMock,
    },
    taskX402PaymentAction: {
      groupBy: actionGroupByMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/services/task-x402-payment.refund", () => ({
  refundVerifiedTaskX402Payment: refundVerifiedMock,
  resolvePendingTaskX402Payment: resolvePendingMock,
}));

const { default: mountList } = await import("./get.js");
const { default: mountAggregate } = await import("./aggregate/get.js");
const { default: mountRefund } = await import("./[id]/refund/post.js");
const { default: mountResolve } = await import("./[id]/resolve/post.js");

function createApp(role: string = "admin") {
  authContextState.current = {
    actor: "user",
    userId: "user_admin",
    organizationId: null,
    role,
    authenticationMethod: "session",
  };

  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountList(app);
  mountAggregate(app);
  mountRefund(app);
  mountResolve(app);
  return app;
}

/** Mounts one handler WITHOUT the parent admin guard, to prove it guards itself. */
function createUnguardedApp(
  role: string,
  mount: (app: OpenAPIHonoWithAuth) => void,
  authenticationMethod: "session" | "api_key" | "oauth" = "session",
) {
  authContextState.current = {
    actor: "user",
    userId: "user_member",
    organizationId: null,
    role,
    authenticationMethod,
  };

  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  mount(app);
  return app;
}

function verifiedPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    createdAt: new Date("2026-08-10T09:00:00.000Z"),
    updatedAt: new Date("2026-08-10T10:00:00.000Z"),
    status: "VERIFIED",
    taskId: "task-1",
    agentId: "agent-1",
    caip2Network: "eip155:84532",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    amount: "250000",
    payTo: "0x1111111111111111111111111111111111111111",
    failureReason: null,
    attemptId: "attempt-1",
    signAttemptCount: 1,
    signRiskExpiresAt: null,
    validBefore: new Date("2026-08-10T11:00:00.000Z"),
    taskEventId: "event-1",
    transactionId: "transaction-1",
    refundTransactionId: null,
    refundKind: null,
    // 3 credits, stored as a NEGATIVE debit like production
    // (createTaskEventTransaction writes `cents * -1n`); cents carry 10 decimal
    // places (CREDITS_BASE = 1e10). The list route negates to surface +3.
    transaction: { amount: -30_000_000_000n },
    ...overrides,
  };
}

describe("admin task x402 payment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionGroupByMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (queries: Promise<unknown>[]) => Promise.all(queries),
    );
  });

  it("negates the stored negative debit into a positive creditsCharged", async () => {
    // verifiedPaymentRow stores the debit as -30_000_000_000n (production sign).
    // Without the route's negation, creditsCharged would be -3 and the
    // nonnegative() schema would 500 the whole list. 200 + creditsCharged: 3
    // proves the negation is live.
    paymentFindManyMock.mockResolvedValue([verifiedPaymentRow()]);
    paymentCountMock.mockResolvedValue(1);

    const response = await createApp().request("/?limit=20");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "pay-1",
        status: "VERIFIED",
        agentId: "agent-1",
        amount: "250000",
        creditsCharged: 3,
        signAttemptCount: 1,
        refundTransactionId: null,
      }),
    ]);
  });

  it("surfaces which lever produced a REFUNDED row", async () => {
    // Without refundKind on the row, a REFUNDED payment is ambiguous on the
    // operator's screen too: an operator goodwill refund (a quality signal) and
    // a support resolve of a wedged PENDING charge (not one) look identical.
    paymentFindManyMock.mockResolvedValue([
      verifiedPaymentRow({
        status: "REFUNDED",
        refundTransactionId: "refund-1",
        refundKind: "OPERATOR_RESOLVE",
      }),
    ]);
    paymentCountMock.mockResolvedValue(1);

    const response = await createApp().request("/?limit=20");

    expect(response.status).toBe(200);
    expect(paymentFindManyMock.mock.calls[0]?.[0]?.select?.refundKind).toBe(
      true,
    );
    const body = await response.json();
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        status: "REFUNDED",
        refundKind: "OPERATOR_RESOLVE",
      }),
    );
  });

  it("uses the debit magnitude so a sign-anomalous row cannot 500 the list", async () => {
    // A data anomaly could leave a positive amount. creditsCharged must still
    // be the positive magnitude (not a negative that fails the nonnegative()
    // schema and 500s every row in the response). The magnitude is NOT a flag:
    // the row is shown as a normal charge, so a positive stored debit is
    // indistinguishable from a real one on this surface. Deliberate — one
    // anomalous row must not 500 the operator's whole view — and the anomaly is
    // recoverable from `transactionId` when a dispute needs it.
    paymentFindManyMock.mockResolvedValue([
      verifiedPaymentRow({ transaction: { amount: 30_000_000_000n } }),
    ]);
    paymentCountMock.mockResolvedValue(1);

    const response = await createApp().request("/?limit=20");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toEqual(
      expect.objectContaining({ creditsCharged: 3 }),
    );
  });

  it("trims the take+1 probe row off the page and points nextCursor at the last returned row", async () => {
    // The handler over-fetches by one to detect a next page. Without the
    // slice, that probe row leaks into `data` and every page returns one more
    // row than the caller asked for.
    const take = 2;
    paymentFindManyMock.mockResolvedValue([
      verifiedPaymentRow({ id: "pay-1" }),
      verifiedPaymentRow({ id: "pay-2" }),
      verifiedPaymentRow({ id: "pay-3" }),
    ]);
    paymentCountMock.mockResolvedValue(3);

    const response = await createApp().request(`/?limit=${take}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(paymentFindManyMock.mock.calls[0]?.[0]?.take).toBe(take + 1);
    expect(body.data).toHaveLength(take);
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      "pay-1",
      "pay-2",
    ]);
    // nextCursor comes off the LAST returned row, so it doubles as proof the
    // probe row was trimmed: untrimmed, it would be "pay-3".
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: take,
      total: 3,
      nextCursor: "pay-2",
    });
  });

  it("counts only the rows matching the active filters", async () => {
    // `total` must describe the filtered set. Counting without the where
    // clause reports the whole table against a filtered page, so an operator
    // scoping to one agent sees every other agent's payments in the total.
    paymentFindManyMock.mockResolvedValue([verifiedPaymentRow()]);
    paymentCountMock.mockResolvedValue(1);

    await createApp().request("/?limit=20&agentId=agent-x&status=VERIFIED");

    expect(paymentCountMock).toHaveBeenCalledWith({
      where: { status: "VERIFIED", agentId: "agent-x" },
    });
  });

  it("NEVER selects or returns the bearer xPaymentHeader", async () => {
    paymentFindManyMock.mockResolvedValue([verifiedPaymentRow()]);
    paymentCountMock.mockResolvedValue(1);

    const response = await createApp().request("/?limit=20");
    const body = await response.json();

    // (a) exclusion at the SELECT level (the schema/select requirement), not
    // just a stripped response: the query must never request the column.
    const selectArg = paymentFindManyMock.mock.calls[0]?.[0]?.select as Record<
      string,
      unknown
    >;
    expect(selectArg.xPaymentHeader).toBeUndefined();
    expect(selectArg).not.toHaveProperty("xPaymentHeader");
    // Raw signed-payload fields are also never selected.
    expect(selectArg.payerAddress).toBeUndefined();
    expect(selectArg.payloadNonce).toBeUndefined();
    expect(selectArg.paymentPayloadHash).toBeUndefined();
    // (b) belt-and-suspenders: no such key on the wire either.
    for (const item of body.data as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty("xPaymentHeader");
    }
  });

  it("passes status / agentId / network filters into the where clause", async () => {
    paymentFindManyMock.mockResolvedValue([]);
    paymentCountMock.mockResolvedValue(0);

    await createApp().request(
      "/?status=FAILED&agentId=agent-9&caip2Network=eip155:8453",
    );

    expect(paymentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "FAILED",
          agentId: "agent-9",
          caip2Network: "eip155:8453",
        },
      }),
    );
  });

  it("bounds the filter strings instead of passing any length to the database", async () => {
    // No injection here (Prisma parameterises, and these are equality filters),
    // but an unbounded operator-supplied string has no business reaching the
    // query at all. caip2Network is capped at the column's own width (64) and
    // agentId at 128; a bogus value now fails at the edge with a 422 rather
    // than as a silently empty result page.
    const overLongAgent = "a".repeat(129);
    const overLongNetwork = `eip155:${"9".repeat(58)}`;

    const [agentResponse, networkResponse] = await Promise.all([
      createApp().request(`/?agentId=${overLongAgent}`),
      createApp().request(`/?caip2Network=${overLongNetwork}`),
    ]);

    expect(agentResponse.status).toBe(422);
    expect(networkResponse.status).toBe(422);
    expect(paymentFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects empty or whitespace-only list filters instead of broadening the query", async () => {
    const [emptyAgentResponse, blankNetworkResponse] = await Promise.all([
      createApp().request("/?agentId="),
      createApp().request("/?caip2Network=%20%20"),
    ]);

    expect(emptyAgentResponse.status).toBe(422);
    expect(blankNetworkResponse.status).toBe(422);
    expect(paymentFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects empty aggregate filters instead of aggregating every payment", async () => {
    const response = await createApp().request("/aggregate?agentId=");

    expect(response.status).toBe(422);
    expect(paymentGroupByMock).not.toHaveBeenCalled();
  });

  it("bounds the payment id on a money lever", async () => {
    const response = await createApp().request(`/${"p".repeat(129)}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "agent_output_quality" }),
    });

    expect(response.status).toBe(422);
    expect(refundVerifiedMock).not.toHaveBeenCalled();
  });

  it("combines live lifecycle totals with durable outcome counts", async () => {
    paymentGroupByMock.mockResolvedValue([
      {
        agentId: "agent-a",
        status: "VERIFIED",
        refundKind: null,
        _count: { _all: 5 },
      },
      {
        agentId: "agent-a",
        status: "FAILED",
        refundKind: "NODE_REFUSAL",
        _count: { _all: 2 },
      },
      {
        agentId: "agent-a",
        status: "REFUNDED",
        refundKind: "OPERATOR_GOODWILL",
        _count: { _all: 1 },
      },
      {
        agentId: "agent-b",
        status: "VERIFIED",
        refundKind: null,
        _count: { _all: 4 },
      },
      {
        agentId: "agent-b",
        status: "PENDING",
        refundKind: null,
        _count: { _all: 1 },
      },
    ]);
    actionGroupByMock.mockResolvedValue([
      {
        agentId: "agent-a",
        action: "failure",
        _count: { _all: 2 },
      },
      {
        agentId: "agent-a",
        action: "refund",
        _count: { _all: 1 },
      },
    ]);

    const response = await createApp().request("/aggregate");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(paymentGroupByMock).toHaveBeenCalledTimes(1);
    expect(actionGroupByMock).toHaveBeenCalledTimes(1);
    expect(paymentGroupByMock.mock.calls[0]?.[0]?.by).toEqual([
      "agentId",
      "status",
    ]);
    expect(actionGroupByMock.mock.calls[0]?.[0]).toMatchObject({
      by: ["agentId", "action"],
      where: {
        action: { in: ["failure", "refund", "resolve"] },
      },
    });
    expect(body.data).toEqual([
      {
        agentId: "agent-a",
        total: 8,
        pending: 0,
        verified: 5,
        failed: 2,
        refunded: 1,
        failureCount: 2,
        goodwillRefundCount: 1,
        operatorResolveCount: 0,
      },
      {
        agentId: "agent-b",
        total: 5,
        pending: 1,
        verified: 4,
        failed: 0,
        refunded: 0,
        failureCount: 0,
        goodwillRefundCount: 0,
        operatorResolveCount: 0,
      },
    ]);
  });

  it("never counts an operator resolve as a goodwill refund", async () => {
    // The false-ranking case. agent-a's coworker integration wedges 20 PENDING
    // rows that support clears with the resolve lever; every one lands
    // REFUNDED. agent-b has ONE real goodwill refund (a paid-but-bad result).
    // If resolves counted as goodwill, agent-a would rank first as the
    // worst quality-bleeding endpoint and an operator would disable a healthy
    // agent — the exact conflation the refundKind discriminator exists to stop.
    paymentGroupByMock.mockResolvedValue([
      {
        agentId: "agent-a",
        status: "REFUNDED",
        refundKind: "OPERATOR_RESOLVE",
        _count: { _all: 20 },
      },
      {
        agentId: "agent-a",
        status: "VERIFIED",
        refundKind: null,
        _count: { _all: 40 },
      },
      {
        agentId: "agent-b",
        status: "REFUNDED",
        refundKind: "OPERATOR_GOODWILL",
        _count: { _all: 1 },
      },
    ]);
    actionGroupByMock.mockResolvedValue([
      {
        agentId: "agent-a",
        action: "resolve",
        _count: { _all: 20 },
      },
      {
        agentId: "agent-b",
        action: "refund",
        _count: { _all: 1 },
      },
    ]);

    const response = await createApp().request("/aggregate");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        agentId: "agent-b",
        refunded: 1,
        goodwillRefundCount: 1,
        operatorResolveCount: 0,
      }),
      expect.objectContaining({
        agentId: "agent-a",
        // The resolves are still visible as REFUNDED rows and as their own
        // count — they just do not drive the quality rank.
        refunded: 20,
        goodwillRefundCount: 0,
        operatorResolveCount: 20,
      }),
    ]);
  });

  it("counts a REFUNDED row of unknown kind as neither goodwill nor resolve", async () => {
    // A REFUNDED row with no refundKind is a legacy/anomalous row: both levers
    // write the kind inside the same update that mints the refund. It must not
    // be guessed into the ranking signal — `refunded` still shows it, so the
    // difference is visible to the operator.
    paymentGroupByMock.mockResolvedValue([
      {
        agentId: "agent-a",
        status: "REFUNDED",
        refundKind: null,
        _count: { _all: 3 },
      },
    ]);

    const response = await createApp().request("/aggregate");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        agentId: "agent-a",
        refunded: 3,
        goodwillRefundCount: 0,
        operatorResolveCount: 0,
      }),
    ]);
  });

  it("retains outcome metrics after account deletion removes the payment row", async () => {
    paymentGroupByMock.mockResolvedValue([]);
    actionGroupByMock.mockResolvedValue([
      { agentId: "deleted-agent", action: "failure", _count: { _all: 3 } },
      { agentId: "deleted-agent", action: "refund", _count: { _all: 2 } },
      { agentId: "deleted-agent", action: "resolve", _count: { _all: 1 } },
    ]);

    const response = await createApp().request("/aggregate");

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([
      {
        agentId: "deleted-agent",
        total: 0,
        pending: 0,
        verified: 0,
        failed: 0,
        refunded: 0,
        failureCount: 3,
        goodwillRefundCount: 2,
        operatorResolveCount: 1,
      },
    ]);
  });

  it("ranks by goodwill refunds then failures — NOT alphabetically", async () => {
    // 3 agents whose money-rank fully DISAGREES with alphabetical order:
    //   money-rank: zzz (goodwill 5) > mmm (goodwill 2, failures 5) > aaa
    //              (goodwill 2, failures 0)   [mmm before aaa on the failure
    //              tiebreak, both tied at goodwill 2]
    //   alphabetical: aaa, mmm, zzz  (the reverse of the money-rank leader)
    // A comparator that fell back to pure agentId.localeCompare would return
    // [aaa, mmm, zzz]; dropping the failureCount tiebreak would return
    // [zzz, aaa, mmm]. Only the real money-ranked comparator yields the order
    // asserted below.
    paymentGroupByMock.mockResolvedValue([
      {
        agentId: "zzz",
        status: "REFUNDED",
        refundKind: "OPERATOR_GOODWILL",
        _count: { _all: 5 },
      },
      {
        agentId: "zzz",
        status: "FAILED",
        refundKind: "NODE_REFUSAL",
        _count: { _all: 1 },
      },
      {
        agentId: "mmm",
        status: "REFUNDED",
        refundKind: "OPERATOR_GOODWILL",
        _count: { _all: 2 },
      },
      {
        agentId: "mmm",
        status: "FAILED",
        refundKind: "NODE_REFUSAL",
        _count: { _all: 5 },
      },
      {
        agentId: "aaa",
        status: "REFUNDED",
        refundKind: "OPERATOR_GOODWILL",
        _count: { _all: 2 },
      },
    ]);
    actionGroupByMock.mockResolvedValue([
      { agentId: "zzz", action: "refund", _count: { _all: 5 } },
      { agentId: "zzz", action: "failure", _count: { _all: 1 } },
      { agentId: "mmm", action: "refund", _count: { _all: 2 } },
      { agentId: "mmm", action: "failure", _count: { _all: 5 } },
      { agentId: "aaa", action: "refund", _count: { _all: 2 } },
    ]);

    const response = await createApp().request("/aggregate");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.data.map(
        (row: { agentId: string; goodwillRefundCount: number }) => row.agentId,
      ),
    ).toEqual(["zzz", "mmm", "aaa"]);
    expect(body.data).toEqual([
      expect.objectContaining({ agentId: "zzz", goodwillRefundCount: 5 }),
      expect.objectContaining({
        agentId: "mmm",
        goodwillRefundCount: 2,
        failureCount: 5,
      }),
      expect.objectContaining({
        agentId: "aaa",
        goodwillRefundCount: 2,
        failureCount: 0,
      }),
    ]);
  });

  it("scopes the aggregation to a single agent when filtered", async () => {
    paymentGroupByMock.mockResolvedValue([]);

    await createApp().request("/aggregate?agentId=agent-x");

    for (const call of paymentGroupByMock.mock.calls) {
      expect(call[0].where).toEqual(
        expect.objectContaining({ agentId: "agent-x" }),
      );
    }
    expect(actionGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: "agent-x" }),
      }),
    );
  });

  it("scopes the aggregation to a single network when filtered", async () => {
    // The caip2Network filter is a separate branch from agentId; covering only
    // the latter leaves a dropped network filter silently aggregating every
    // chain into one rollup.
    paymentGroupByMock.mockResolvedValue([]);

    await createApp().request("/aggregate?caip2Network=eip155:84532");

    for (const call of paymentGroupByMock.mock.calls) {
      expect(call[0].where).toEqual(
        expect.objectContaining({ caip2Network: "eip155:84532" }),
      );
    }
    expect(actionGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ caip2Network: "eip155:84532" }),
      }),
    );
  });

  it("scopes the aggregation to the visible status filter", async () => {
    paymentGroupByMock.mockResolvedValue([]);

    await createApp().request("/aggregate?status=PENDING");

    expect(paymentGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" } }),
    );
    expect(actionGroupByMock).not.toHaveBeenCalled();
  });

  it("refunds a verified payment with an operator reason", async () => {
    refundVerifiedMock.mockResolvedValue({
      status: "refunded",
      paymentId: "pay-1",
      reason:
        "Administrator user_admin refunded x402 payment: agent_output_quality",
      compensated: true,
    });

    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "agent_output_quality" }),
    });

    expect(response.status).toBe(200);
    expect(refundVerifiedMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      operatorId: "user_admin",
      reason: "agent_output_quality",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "refunded", compensated: true },
    });
  });

  it("rejects a refund without an operator reason", async () => {
    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "  " }),
    });

    expect(response.status).toBe(422);
    expect(refundVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects narrative refund reasons that would persist after account deletion", async () => {
    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Customer Jane Doe reported a bad result",
      }),
    });

    expect(response.status).toBe(422);
    expect(refundVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects a refund sent with no body at all", async () => {
    // The route declares `body: { required: true }`. Without it,
    // @hono/zod-openapi skips body validation ENTIRELY when the request carries
    // no JSON content-type: this same request reaches the handler, the money
    // lever runs with no recorded operator rationale, and the 422 that should
    // have stopped it never happens. Asserting the service was not called is
    // the half that matters — a downstream 500 is not a route-level guarantee.
    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(refundVerifiedMock).not.toHaveBeenCalled();
  });

  it("maps an already-refunded payment to 409 (idempotent guard)", async () => {
    refundVerifiedMock.mockResolvedValue({ status: "already_refunded" });

    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "duplicate_charge" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "already_refunded",
    });
  });

  it("maps a pending (non-refundable) payment to 409", async () => {
    refundVerifiedMock.mockResolvedValue({
      status: "not_refundable",
      reason: "Payment is pending; ...",
    });

    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "support_adjustment" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "not_refundable",
      message: "Payment is pending; ...",
    });
  });

  it("maps a missing payment to 404", async () => {
    refundVerifiedMock.mockResolvedValue({ status: "not_found" });

    const response = await createApp().request("/pay-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "support_adjustment" }),
    });

    expect(response.status).toBe(404);
  });

  it("resolves a pending payment with an operator reason", async () => {
    resolvePendingMock.mockResolvedValue({
      status: "resolved",
      paymentId: "pay-1",
      reason:
        "Administrator user_admin resolved x402 payment: unsettleable_authorization",
      compensated: true,
    });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "unsettleable_authorization" }),
    });

    expect(response.status).toBe(200);
    expect(resolvePendingMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      operatorId: "user_admin",
      reason: "unsettleable_authorization",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "resolved", compensated: true },
    });
  });

  it("rejects a resolve without an operator reason", async () => {
    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "  " }),
    });

    expect(response.status).toBe(422);
    expect(resolvePendingMock).not.toHaveBeenCalled();
  });

  it("rejects narrative resolve reasons that would persist after account deletion", async () => {
    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Delete alice@example.com after support case 42",
      }),
    });

    expect(response.status).toBe(422);
    expect(resolvePendingMock).not.toHaveBeenCalled();
  });

  it("rejects a resolve sent with no body at all", async () => {
    // Same control as the refund route's, on the other money lever. See the
    // refund case above for why the "service not called" half is the one that
    // holds the guarantee.
    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(resolvePendingMock).not.toHaveBeenCalled();
  });

  it("maps an already-resolved payment to 409 (idempotent guard)", async () => {
    resolvePendingMock.mockResolvedValue({ status: "already_resolved" });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "sign_attempts_exhausted" }),
    });

    expect(response.status).toBe(409);
  });

  it("maps a VERIFIED (non-resolvable) payment to 409", async () => {
    resolvePendingMock.mockResolvedValue({
      status: "not_resolvable",
      reason:
        "Payment is verified; use the goodwill refund lever, which is the only one allowed to reverse a live header",
    });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "unsettleable_authorization" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "not_resolvable",
      message: expect.stringContaining("goodwill refund"),
    });
  });

  it("maps a lease-held payment to 409 and tells the operator when to retry", async () => {
    resolvePendingMock.mockResolvedValue({
      status: "sign_in_flight",
      reason:
        "Another request is signing this x402 payment; its sign lease expires at 2026-08-12T10:00:30.000Z. Retry the resolve after that (about 25s).",
      retryAfterSeconds: 25,
      retryAfter: "2026-08-12T10:00:30.000Z",
    });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "sign_attempts_exhausted" }),
    });

    expect(response.status).toBe(409);
    // Machine-readable retry instant, not only ISO buried in the message.
    await expect(response.json()).resolves.toMatchObject({
      kind: "sign_in_flight",
      message: expect.stringContaining("2026-08-12T10:00:30.000Z"),
      retryAfter: "2026-08-12T10:00:30.000Z",
      retryAfterSeconds: 25,
    });
  });

  it("maps unresolved authorization risk to an actionable 409", async () => {
    resolvePendingMock.mockResolvedValue({
      status: "sign_outcome_unresolved",
      reason:
        "A discarded authorization may remain live until 2026-08-12T11:00:00.000Z.",
      retryAfterSeconds: 120,
      retryAfter: "2026-08-12T11:00:00.000Z",
    });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "node_unreachable" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "sign_outcome_unresolved",
      message: expect.stringContaining("2026-08-12T11:00:00.000Z"),
      retryAfter: "2026-08-12T11:00:00.000Z",
      retryAfterSeconds: 120,
    });
  });

  it("maps a missing payment to 404 on resolve", async () => {
    resolvePendingMock.mockResolvedValue({ status: "not_found" });

    const response = await createApp().request("/pay-1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "node_unreachable" }),
    });

    expect(response.status).toBe(404);
  });

  it("keeps the resolve handler admin-only without its parent router guard", async () => {
    const response = await createUnguardedApp("member", mountResolve).request(
      "/pay-1/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "node_unreachable" }),
      },
    );

    expect(response.status).toBe(403);
    expect(resolvePendingMock).not.toHaveBeenCalled();
  });

  it("keeps the list handler admin-only without its parent router guard", async () => {
    const response = await createUnguardedApp("member", mountList).request("/");

    expect(response.status).toBe(403);
    expect(paymentFindManyMock).not.toHaveBeenCalled();
  });

  it("keeps the aggregate handler admin-only without its parent router guard", async () => {
    const response = await createUnguardedApp("member", mountAggregate).request(
      "/aggregate",
    );

    expect(response.status).toBe(403);
    expect(paymentGroupByMock).not.toHaveBeenCalled();
  });

  it("keeps the refund handler admin-only without its parent router guard", async () => {
    const response = await createUnguardedApp("member", mountRefund).request(
      "/pay-1/refund",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "support_adjustment" }),
      },
    );

    expect(response.status).toBe(403);
    expect(refundVerifiedMock).not.toHaveBeenCalled();
  });

  it.each(["api_key", "oauth"] as const)(
    "rejects admin %s credentials on both money actions",
    async (authenticationMethod) => {
      const app = createUnguardedApp(
        "admin",
        (router) => {
          mountRefund(router);
          mountResolve(router);
        },
        authenticationMethod,
      );
      const request = (path: string, reason: string) =>
        app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        });

      const [refundResponse, resolveResponse] = await Promise.all([
        request("/pay-1/refund", "support_adjustment"),
        request("/pay-1/resolve", "node_unreachable"),
      ]);

      expect(refundResponse.status).toBe(403);
      expect(resolveResponse.status).toBe(403);
      expect(refundVerifiedMock).not.toHaveBeenCalled();
      expect(resolvePendingMock).not.toHaveBeenCalled();
    },
  );

  it("rejects non-admin users", async () => {
    const response = await createApp("member").request("/");

    expect(response.status).toBe(403);
    expect(paymentFindManyMock).not.toHaveBeenCalled();
  });
});
