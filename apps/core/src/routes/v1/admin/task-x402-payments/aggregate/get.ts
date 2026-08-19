import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskX402PaymentAggregateQuerySchema,
  adminTaskX402PaymentAggregateSchema,
} from "@/schemas/admin-task-x402-payment.schema";

const route = createRoute({
  method: "get",
  path: "/aggregate",
  operationId: "aggregateAdminTaskX402PaymentsByAgent",
  description:
    "Per-agent x402 payment rollup (PR1-SPEC §5): durable goodwill-refund and failure counts ranked worst-first, plus lifecycle totals from retained payment rows (admin only).",
  tags: ["Admin"],
  request: { query: adminTaskX402PaymentAggregateQuerySchema },
  responses: {
    200: jsonSuccessResponse(
      adminTaskX402PaymentAggregateSchema,
      "Per-agent x402 payment aggregation",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

interface AgentRollup {
  agentId: string;
  total: number;
  pending: number;
  verified: number;
  failed: number;
  refunded: number;
  failureCount: number;
  goodwillRefundCount: number;
  operatorResolveCount: number;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const query = c.req.valid("query");
    const where: Prisma.TaskX402PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.caip2Network ? { caip2Network: query.caip2Network } : {}),
    };

    // Live rows supply current lifecycle totals. The FK-free action ledger
    // supplies durable outcome counters, so account deletion cannot erase the
    // quality/operational history used to rank an agent.
    //
    //   - NODE_REFUSAL      → row stays FAILED; node-budget concern, already
    //                         counted by failureCount.
    //   - OPERATOR_RESOLVE  → row is REFUNDED, from PENDING. A wedged charge
    //                         support cleared (ambiguous 200s, node timeouts,
    //                         a GDPR erasure blocked by the row). Counted on
    //                         its own so the operator still sees it, but it
    //                         must NOT rank the agent as quality-bleeding: a
    //                         hostile coworker could otherwise wedge PENDING
    //                         rows to drive a competitor's agent to the top of
    //                         this list.
    //   - OPERATOR_GOODWILL → row is REFUNDED, from VERIFIED. "We charged for
    //                         a bad result" — the one that ranks.
    const durableActions =
      query.status === "PENDING" || query.status === "VERIFIED"
        ? []
        : query.status === "FAILED"
          ? ["failure"]
          : query.status === "REFUNDED"
            ? ["refund", "resolve"]
            : ["failure", "refund", "resolve"];
    const actionWhere: Prisma.TaskX402PaymentActionWhereInput = {
      action: { in: durableActions },
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.caip2Network ? { caip2Network: query.caip2Network } : {}),
    };

    const [statusGroups, actionGroups] = await Promise.all([
      prisma.taskX402Payment.groupBy({
        by: ["agentId", "status", "refundKind"],
        where,
        _count: { _all: true },
      }),
      durableActions.length === 0
        ? Promise.resolve([])
        : prisma.taskX402PaymentAction.groupBy({
            by: ["agentId", "action"],
            where: actionWhere,
            _count: { _all: true },
          }),
    ]);

    const rollups = new Map<string, AgentRollup>();
    for (const row of statusGroups) {
      const count = row._count._all;
      const rollup = rollups.get(row.agentId) ?? {
        agentId: row.agentId,
        total: 0,
        pending: 0,
        verified: 0,
        failed: 0,
        refunded: 0,
        failureCount: 0,
        goodwillRefundCount: 0,
        operatorResolveCount: 0,
      };
      rollup.total += count;
      if (row.status === "PENDING") {
        rollup.pending += count;
      } else if (row.status === "VERIFIED") {
        rollup.verified += count;
      } else if (row.status === "FAILED") {
        rollup.failed += count;
      } else if (row.status === "REFUNDED") {
        rollup.refunded += count;
      }
      rollups.set(row.agentId, rollup);
    }

    for (const row of actionGroups) {
      const count = row._count._all;
      const rollup = rollups.get(row.agentId) ?? {
        agentId: row.agentId,
        total: 0,
        pending: 0,
        verified: 0,
        failed: 0,
        refunded: 0,
        failureCount: 0,
        goodwillRefundCount: 0,
        operatorResolveCount: 0,
      };
      if (row.action === "failure") {
        rollup.failureCount += count;
      } else if (row.action === "refund") {
        rollup.goodwillRefundCount += count;
      } else if (row.action === "resolve") {
        rollup.operatorResolveCount += count;
      }
      rollups.set(row.agentId, rollup);
    }

    // Bleeding endpoints first: most goodwill refunds (the quality signal),
    // then most refusals, then agentId for a stable tiebreak. Resolves are
    // deliberately NOT in the comparator — see above.
    const items = [...rollups.values()].sort(
      (a, b) =>
        b.goodwillRefundCount - a.goodwillRefundCount ||
        b.failureCount - a.failureCount ||
        a.agentId.localeCompare(b.agentId),
    );

    return ok(c, adminTaskX402PaymentAggregateSchema.parse(items));
  });
}
