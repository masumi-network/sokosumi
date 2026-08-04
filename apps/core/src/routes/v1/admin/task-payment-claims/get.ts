import { createRoute } from "@hono/zod-openapi";
import { TaskPaymentClaimStatus } from "@sokosumi/database";
import { getEnv } from "@/config/env";
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
import {
  adminTaskPaymentClaimListQuerySchema,
  adminTaskPaymentClaimListSchema,
} from "@/schemas/admin-task-payment-claim.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminTaskPaymentClaimsRequiringReview",
  description:
    "List pending task payment claims that exceeded automatic retry limits and require operator review (admin only).",
  tags: ["Admin"],
  request: { query: adminTaskPaymentClaimListQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminTaskPaymentClaimListSchema,
      "Task payment claims requiring review",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    const where = {
      network: getEnv().NETWORK,
      status: TaskPaymentClaimStatus.PENDING,
      reviewRequiredAt: { not: null },
    } as const;
    const takePlusOne = take + 1;
    const [claims, total] = await prisma.$transaction([
      prisma.taskPaymentClaim.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ reviewRequiredAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          network: true,
          blockchainIdentifier: true,
          failureReason: true,
          attemptCount: true,
          lastAttemptAt: true,
          nextAttemptAt: true,
          reviewRequiredAt: true,
          taskEventId: true,
          transactionId: true,
          transaction: {
            select: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      prisma.taskPaymentClaim.count({ where }),
    ]);

    const hasMore = claims.length === takePlusOne;
    const items = claims.slice(0, take).map((claim) => {
      if (!claim.reviewRequiredAt) {
        throw new Error(
          `Reviewed task payment claim ${claim.id} has no review timestamp`,
        );
      }
      const { transaction, ...claimData } = claim;
      return {
        ...claimData,
        reviewRequiredAt: claim.reviewRequiredAt,
        user: transaction.user,
      };
    });
    const pagination = createPaginationMeta(
      items,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminTaskPaymentClaimListSchema.parse(items), pagination);
  });
}
