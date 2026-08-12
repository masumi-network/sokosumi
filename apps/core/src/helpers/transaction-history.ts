import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";
import { forbidden } from "@/helpers/error";
import type prisma from "@/lib/db/prisma";
import type { WorkspaceContext } from "@/middleware/workspace";
import type {
  TransactionHistoryItem,
  transactionSourceSchema,
} from "@/schemas/transaction.schema";

type TransactionSource = z.infer<typeof transactionSourceSchema>;

export const transactionHistoryInclude = {
  job: { select: { id: true, agentId: true } },
  refundedJob: { select: { id: true, agentId: true } },
  taskPaymentClaim: { select: { id: true } },
  coworkerUsage: { select: { id: true } },
  orchestratorUsage: { select: { id: true } },
  sourceCreditBucket: { select: { id: true } },
} satisfies Prisma.TransactionInclude;

export type TransactionRowForHistory = Prisma.TransactionGetPayload<{
  include: typeof transactionHistoryInclude;
}>;

/**
 * Scopes transactions the same way the existing balance aggregates do
 * (`transactionRepository.getCentsByUserId` / `getCentsByOrganizationId`):
 * an organization workspace pools every member's transactions under that
 * organization; a personal workspace is scoped to the owning user with no
 * organization.
 */
export function buildTransactionHistoryWhere(
  workspaceContext: WorkspaceContext,
): Prisma.TransactionWhereInput {
  if (workspaceContext.organizationId) {
    return { organizationId: workspaceContext.organizationId };
  }

  // A personal workspace always has an owning user (enforced by
  // `workspaceRepository.upsertWorkspaceForContext`, which sets exactly one
  // of `userId`/`organizationId`). Fail closed instead of building a
  // where-clause with no `userId` filter, which would leak every personal
  // workspace's transactions.
  if (!workspaceContext.userId) {
    throw forbidden("Workspace is missing an owning user");
  }

  return { userId: workspaceContext.userId, organizationId: null };
}

/**
 * Derives a coarse, always-safe source label from which relation is
 * populated on the row. Falls back to `"other"` for grant sources not yet
 * broken out individually (subscription/enterprise/seat/signup-bonus
 * credits) rather than guessing — see `apps/core/src/helpers/transaction-history.test.ts`
 * for the call sites this must stay in sync with.
 */
export function resolveTransactionSource(
  row: TransactionRowForHistory,
): TransactionSource {
  if (row.refundedJob) return "job_refund";
  if (row.job) return "job_purchase";
  if (row.taskPaymentClaim) return "task_usage";
  if (row.coworkerUsage) return "coworker_usage";
  if (row.orchestratorUsage) return "orchestrator_usage";
  if (row.sourceCreditBucket) return "credit_grant";
  return "other";
}

export function mapTransactionRow(
  row: TransactionRowForHistory,
): TransactionHistoryItem {
  const job = row.job ?? row.refundedJob;

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    credits: convertCentsToCredits(row.amount),
    source: resolveTransactionSource(row),
    jobId: job?.id ?? null,
    agentId: job?.agentId ?? null,
  };
}

export type TransactionQueryClient = {
  transaction: Pick<(typeof prisma)["transaction"], "count" | "findMany">;
};

export async function getTransactionHistory(
  workspaceContext: WorkspaceContext,
  options: {
    cursor?: string;
    take: number;
    skip?: number;
  },
  tx: TransactionQueryClient,
): Promise<{
  items: TransactionHistoryItem[];
  count: number;
  hasMore: boolean;
}> {
  const { cursor, take, skip } = options;
  const where = buildTransactionHistoryWhere(workspaceContext);
  const takePlusOne = take + 1;

  const [rows, count] = await Promise.all([
    tx.transaction.findMany({
      where,
      take: takePlusOne,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: transactionHistoryInclude,
    }),
    tx.transaction.count({ where }),
  ]);

  const hasMore = rows.length === takePlusOne;

  return {
    items: rows.slice(0, take).map(mapTransactionRow),
    count,
    hasMore,
  };
}
