import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskX402PaymentListQuerySchema,
  adminTaskX402PaymentListSchema,
} from "@/schemas/admin-task-x402-payment.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminTaskX402Payments",
  description:
    "List x402 payments for observability and support (admin only). The signed X-PAYMENT header is a bearer instrument and is never returned.",
  tags: ["Admin"],
  request: { query: adminTaskX402PaymentListQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminTaskX402PaymentListSchema,
      "Task x402 payments",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const query = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(query);
    const where: Prisma.TaskX402PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.caip2Network ? { caip2Network: query.caip2Network } : {}),
    };
    const takePlusOne = take + 1;
    const [payments, total] = await prisma.$transaction([
      prisma.taskX402Payment.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Explicit column select — NEVER `include` / a whole-row select. The
        // signed `xPaymentHeader` (and the raw signed-payload fields) are a
        // bearer instrument and must never reach an admin/support surface
        // (step-5 review, finding 7).
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          status: true,
          taskId: true,
          agentId: true,
          caip2Network: true,
          asset: true,
          amount: true,
          payTo: true,
          failureReason: true,
          attemptId: true,
          signAttemptCount: true,
          signRiskExpiresAt: true,
          validBefore: true,
          taskEventId: true,
          transactionId: true,
          refundTransactionId: true,
          refundKind: true,
          transaction: { select: { amount: true } },
        },
      }),
      prisma.taskX402Payment.count({ where }),
    ]);

    const hasMore = payments.length === takePlusOne;
    const items = payments.slice(0, take).map((payment) => {
      const { transaction, ...paymentData } = payment;
      // The debit transaction is stored NEGATIVE (createTaskEventTransaction:
      // `amount: input.cents * -1n`). Surface its MAGNITUDE as the positive
      // credit count the schema requires (`creditsCharged` is `nonnegative()`).
      // Using the magnitude rather than a bare negation means a single
      // sign-anomalous row cannot produce a negative value that fails the whole
      // list response's Zod parse and 500s the operator's view.
      const debitCents =
        transaction.amount < 0n ? -transaction.amount : transaction.amount;
      return {
        ...paymentData,
        creditsCharged: convertCentsToCredits(debitCents),
      };
    });
    const pagination = createPaginationMeta(
      items,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminTaskX402PaymentListSchema.parse(items), pagination);
  });
}
