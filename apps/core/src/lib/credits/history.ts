import type {
  OnChainJobStatus,
  TaskX402PaymentRefundKind,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { convertCentsToCredits } from "@sokosumi/utils";
import type { NetworkScope } from "@/lib/db/network-scope";
import type prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import type { TransactionHistoryKind } from "@/schemas/transaction-history.schema";

import { ownsUntaggedSharedRows } from "./policy";

/**
 * A `Transaction` row — a spend or a top up — already resolved against every
 * relation that can explain it. Shaped by {@link buildLedgerSql}.
 */
export interface TransactionHistoryRow {
  id: string;
  consumedAt: Date;
  amount: bigint;
  kind: TransactionHistoryKind;
  userId: string | null;
  projectId: string | null;
  jobId: string | null;
  jobName: string | null;
  agentId: string | null;
  imageJobId: string | null;
  imageModel: string | null;
  imagePrompt: string | null;
  taskId: string | null;
  taskName: string | null;
  taskArchived: boolean | null;
  taskEventId: string | null;
  taskEventComment: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  sokoBotId: string | null;
  sokoBotName: string | null;
  sokoBotTurnSource: string | null;
  sokoBotScheduleName: string | null;
  sokoBotScheduleKey: string | null;
  contactListId: string | null;
  contactListName: string | null;
  contactFound: number | null;
  /** The contact an Enrich looked up; null for a list's Find people. */
  contactName: string | null;
  bucketSource: string | null;
  topUpSource: string | null;
  topUpNote: string | null;
  refundedJobId: string | null;
  refundedJobName: string | null;
  refundedAgentId: string | null;
  refundedJobOnChainStatus: OnChainJobStatus | null;
  refundedTaskId: string | null;
  refundedTaskName: string | null;
  refundedTaskArchived: boolean | null;
  /** Prompt of a legacy studio image job this refund undid. Column is dead for new writes. */
  refundedImagePrompt: string | null;
  refundSource: "job" | "taskPaymentClaim" | "taskX402" | "projectImage" | null;
  refundX402Kind: TaskX402PaymentRefundKind | null;
}

export interface BuildTransactionHistoryParams {
  billingScope: NetworkScope;
  /** Inclusive lower bound on `consumedAt`. */
  from?: Date;
  /** Exclusive upper bound on `consumedAt`. */
  to?: Date;
  kinds?: TransactionHistoryKind[];
  projectId?: string | null;
  q?: string;
  scope: "owned" | "workspace";
  /** Only rows for this Task: its charges, its Jobs' charges and their refunds. */
  taskId?: string;
  userContext: UserContext;
  workspaceContext: WorkspaceContext;
}

export type TransactionHistoryPrismaClient = Pick<typeof prisma, "$queryRaw">;

/**
 * Attribution is resolved in priority order. A positive amount is always a top
 * up (`Transaction.amount` is signed), and it is tested first because a refund
 * links back to its job through `refundTransactionId`, never `transactionId`,
 * so no entity join can claim it.
 *
 * `task_payment_claim` and
 * `task_x402_payment` are deliberately absent: on mainnet every transaction
 * they reference also carries the `taskEvent` that charged it, so listing them
 * here would only shadow a better label.
 */
function transactionKindCase() {
  return PrismaRaw.sql`
  CASE
    WHEN t."amount" > 0 THEN 'topUp'
    WHEN j."id" IS NOT NULL THEN 'job'
    WHEN pij."id" IS NOT NULL THEN 'image'
    WHEN te."id" IS NOT NULL THEN 'task'
    WHEN cu."id" IS NOT NULL THEN 'coworker'
    WHEN sbu."id" IS NOT NULL THEN 'sokoBot'
    WHEN sch."id" IS NOT NULL THEN 'seoChat'
    WHEN cps."id" IS NOT NULL THEN 'contacts'
    ELSE 'unattributed'
  END
`;
}

/**
 * Scopes the ledger to the active workspace. `Transaction` has no
 * `workspaceId`, but `Workspace.userId` and `Workspace.organizationId` are both
 * unique, so a workspace is either one organization's or one user's and the
 * mapping is exact in both directions.
 */
function buildScopeSql({
  scope,
  userContext,
  workspaceContext,
}: BuildTransactionHistoryParams): PrismaRaw.Sql {
  if (workspaceContext.organizationId) {
    const organizationScope = PrismaRaw.sql`t."organizationId" = ${workspaceContext.organizationId}`;

    // An organization workspace holds consumptions with no user at all (a
    // seat-level charge), so "owned" narrows to this user rather than
    // partitioning the workspace.
    return scope === "owned"
      ? PrismaRaw.sql`${organizationScope} AND t."userId" = ${userContext.userId}`
      : organizationScope;
  }

  return PrismaRaw.sql`t."userId" = ${userContext.userId} AND t."organizationId" IS NULL`;
}

function buildFilterSql(
  params: BuildTransactionHistoryParams,
): PrismaRaw.Sql[] {
  const filters: PrismaRaw.Sql[] = [];

  if (params.kinds && params.kinds.length > 0) {
    filters.push(PrismaRaw.sql`ledger."kind" = ANY(${params.kinds}::text[])`);
  }

  if (params.projectId !== undefined) {
    filters.push(
      PrismaRaw.sql`ledger."projectId" IS NOT DISTINCT FROM ${params.projectId}::uuid`,
    );
  }

  if (params.from) {
    filters.push(PrismaRaw.sql`ledger."consumedAt" >= ${params.from}`);
  }

  if (params.to) {
    filters.push(PrismaRaw.sql`ledger."consumedAt" < ${params.to}`);
  }

  if (params.q) {
    filters.push(PrismaRaw.sql`ledger."searchText" ILIKE ${`%${params.q}%`}`);
  }

  if (params.taskId) {
    filters.push(PrismaRaw.sql`ledger."taskRef" = ${params.taskId}`);
  }

  return filters;
}

/**
 * How the ledger joins a shared receipt to a transaction of its Network. Ids
 * are unique within one Network only: the same id can name a Mainnet and a
 * Preprod transaction. Mainnet's ledger keeps its joins as they were (its
 * receipts include every untagged row); another Network's joins a Task
 * event only when the event names that Network, and no Mainnet-only
 * feature's receipt at all.
 */
function sharedReceiptJoins(scope: NetworkScope) {
  const { network } = scope;
  if (ownsUntaggedSharedRows(network)) {
    return {
      taskEvent: PrismaRaw.sql`e."transactionId" = t."id"`,
      image: PrismaRaw.sql`pij."transactionId" = t."id"`,
      seoChat: PrismaRaw.sql`sch."transactionId" = t."id"`,
      contacts: PrismaRaw.sql`cps."transactionId" = t."id"`,
      imageRefund: PrismaRaw.sql`rpij."refundTransactionId" = t."id"`,
    };
  }
  return {
    taskEvent: PrismaRaw.sql`e."transactionId" = t."id" AND e."network" = ${network}`,
    image: PrismaRaw.sql`FALSE`,
    seoChat: PrismaRaw.sql`FALSE`,
    contacts: PrismaRaw.sql`FALSE`,
    imageRefund: PrismaRaw.sql`FALSE`,
  };
}

/**
 * The ledger projection: one row per transaction, labelled by whatever links to
 * it. Selected as a subquery so the computed `kind`, `projectId` and
 * `searchText` are filterable without repeating their expressions.
 */
function buildLedgerSql(params: BuildTransactionHistoryParams): PrismaRaw.Sql {
  const shared = sharedReceiptJoins(params.billingScope);
  return PrismaRaw.sql`
    SELECT
      t."id",
      t."createdAt" AS "consumedAt",
      t."amount",
      t."userId",
      ${transactionKindCase()} AS "kind",
      COALESCE(
        j."projectId",
        pij."projectId",
        tk."projectId",
        rj."projectId",
        rpij."projectId",
        rtk."projectId",
        -- Project credits (ADR 0067): a grant belongs to the Project of the
        -- bucket it created, a write-off to the Project of the bucket it drew.
        topup."projectId",
        bucket."projectId",
        -- This server-owned usage field freezes the payer, independent of later Audit relinking.
        (sch."usage" #>> '{billing,projectId}')::uuid
      ) AS "projectId",
      -- The Task a row belongs to: charged by its event or one of its Jobs,
      -- or a refund of either. Filter-only; the label comes from the columns
      -- below.
      COALESCE(te."taskId", j."taskId", rtk."id", rj."taskId") AS "taskRef",
      j."id" AS "jobId",
      j."name" AS "jobName",
      j."agentId" AS "agentId",
      pij."id"::TEXT AS "imageJobId",
      pij."model" AS "imageModel",
      pij."prompt" AS "imagePrompt",
      te."taskId" AS "taskId",
      tk."name" AS "taskName",
      tk."archivedAt" IS NOT NULL AS "taskArchived",
      te."id" AS "taskEventId",
      te."comment" AS "taskEventComment",
      cu."coworkerId" AS "coworkerId",
      cw."name" AS "coworkerName",
      sbu."sokoBotId"::TEXT AS "sokoBotId",
      sb."name" AS "sokoBotName",
      sbt."source"::TEXT AS "sokoBotTurnSource",
      sbs."name" AS "sokoBotScheduleName",
      sbs."systemKey" AS "sokoBotScheduleKey",
      cps."listId"::TEXT AS "contactListId",
      cl."name" AS "contactListName",
      cps."found" AS "contactFound",
      ct."name" AS "contactName",
      bucket."referenceType" AS "bucketSource",
      topup."referenceType"::TEXT AS "topUpSource",
      topup."referenceNote" AS "topUpNote",
      rj."id" AS "refundedJobId",
      rj."name" AS "refundedJobName",
      rj."agentId" AS "refundedAgentId",
      rjp."onChainStatus"::TEXT AS "refundedJobOnChainStatus",
      rtk."id" AS "refundedTaskId",
      rtk."name" AS "refundedTaskName",
      rtk."archivedAt" IS NOT NULL AS "refundedTaskArchived",
      rpij."prompt" AS "refundedImagePrompt",
      CASE
        WHEN rj."id" IS NOT NULL THEN 'job'
        WHEN rpc."id" IS NOT NULL THEN 'taskPaymentClaim'
        WHEN rx."id" IS NOT NULL THEN 'taskX402'
        WHEN rpij."id" IS NOT NULL THEN 'projectImage'
      END AS "refundSource",
      rx."refundKind"::TEXT AS "refundX402Kind",
      CONCAT_WS(
        ' ',
        j."name",
        a."name",
        pij."model",
        pij."prompt",
        tk."name",
        te."comment",
        cw."name",
        sb."name",
        cl."name",
        topup."referenceType"::TEXT,
        topup."referenceNote",
        rj."name",
        rtk."name",
        rpij."prompt"
      ) AS "searchText"
    FROM ${params.billingScope.networkTable("Transaction")} AS t
    LEFT JOIN ${params.billingScope.networkTable("Job")} AS j ON j."transactionId" = t."id"
    LEFT JOIN ${params.billingScope.networkTable("Agent")} AS a ON a."id" = j."agentId"
    LEFT JOIN ${sharedTable("project_image_job")} AS pij ON ${shared.image}
    -- TaskEvent is one-to-many on the schema even though mainnet has exactly
    -- one per charging transaction, so pick a stable single row.
    LEFT JOIN LATERAL (
      SELECT e."id", e."taskId", e."comment"
      FROM ${sharedTable("taskEvent")} AS e
      WHERE ${shared.taskEvent}
      ORDER BY e."createdAt" ASC, e."id" ASC
      LIMIT 1
    ) AS te ON TRUE
    LEFT JOIN ${sharedTable("task")} AS tk ON tk."id" = te."taskId"
    LEFT JOIN ${params.billingScope.networkTable("coworker_usage")} AS cu ON cu."transactionId" = t."id"
    LEFT JOIN ${sharedTable("coworker")} AS cw ON cw."id" = cu."coworkerId"
    LEFT JOIN ${sharedTable("seo_audit_chat_turn")} AS sch ON ${shared.seoChat}
    LEFT JOIN ${params.billingScope.networkTable("soko_bot_usage")} AS sbu ON sbu."transactionId" = t."id"
    LEFT JOIN ${sharedTable("soko_bot")} AS sb ON sb."id" = sbu."sokoBotId"
    -- A usage row's reference is the turn it billed.
    LEFT JOIN ${sharedTable("soko_bot_turn")} AS sbt ON sbt."id"::TEXT = sbu."referenceId"
    LEFT JOIN ${sharedTable("soko_bot_schedule_run")} AS sbr ON sbr."turnId" = sbt."id"
    LEFT JOIN ${sharedTable("soko_bot_schedule")} AS sbs ON sbs."id" = sbr."scheduleId"
    LEFT JOIN ${sharedTable("contact_people_search")} AS cps ON ${shared.contacts}
    LEFT JOIN ${sharedTable("contact_list")} AS cl ON cl."id" = cps."listId"
    LEFT JOIN ${sharedTable("contact")} AS ct ON ct."id" = cps."contactId"
    -- A spend can draw from several buckets. One is enough to name a source.
    LEFT JOIN LATERAL (
      SELECT b."referenceType"::TEXT AS "referenceType", b."projectId"
      FROM ${params.billingScope.networkTable("credit_consumption")} AS cc
      JOIN ${params.billingScope.networkTable("credit_bucket")} AS b ON b."id" = cc."bucketId"
      WHERE cc."transactionId" = t."id"
      ORDER BY cc."createdAt" ASC, cc."id" ASC
      LIMIT 1
    ) AS bucket ON TRUE
    -- The bucket a top up created. One-to-one with the transaction that paid
    -- for it, so this is a plain join rather than a lateral pick.
    LEFT JOIN ${params.billingScope.networkTable("credit_bucket")} AS topup ON topup."sourceTransactionId" = t."id"
    -- What a refund top up refunded. Each source stores a unique back-reference
    -- to its refund transaction, so these are plain joins. A refund comes from
    -- exactly one of them. project_image_job.refundTransactionId is legacy
    -- (studio no longer writes refunds); keep the join so old rows still name
    -- and link.
    --
    -- A split refund (ADR 0067) links one part; every other part's bucket
    -- carries the linked part's referenceId plus '#<scope>', so it resolves to
    -- the linked refund and names the same record.
    LEFT JOIN ${params.billingScope.networkTable("credit_bucket")} AS linkedrefund
      ON topup."referenceType" = 'REFUND'
      AND POSITION('#' IN topup."referenceId") > 0
      AND linkedrefund."referenceType" = 'REFUND'
      AND linkedrefund."referenceId" = SPLIT_PART(topup."referenceId", '#', 1)
    LEFT JOIN ${params.billingScope.networkTable("Job")} AS rj ON rj."refundedTransactionId" = COALESCE(linkedrefund."sourceTransactionId", t."id")
    LEFT JOIN ${params.billingScope.networkTable("jobPurchase")} AS rjp ON rjp."jobId" = rj."id"
    LEFT JOIN ${params.billingScope.networkTable("task_payment_claim")} AS rpc ON rpc."refundTransactionId" = COALESCE(linkedrefund."sourceTransactionId", t."id")
    LEFT JOIN ${sharedTable("taskEvent")} AS rpce ON rpce."id" = rpc."taskEventId"
    LEFT JOIN ${params.billingScope.networkTable("task_x402_payment")} AS rx ON rx."refundTransactionId" = COALESCE(linkedrefund."sourceTransactionId", t."id")
    LEFT JOIN ${sharedTable("task")} AS rtk ON rtk."id" = COALESCE(rpce."taskId", rx."taskId")
    LEFT JOIN ${sharedTable("project_image_job")} AS rpij ON ${shared.imageRefund}
    WHERE ${buildScopeSql(params)}
  `;
}

function buildWhereSql(filters: PrismaRaw.Sql[]): PrismaRaw.Sql {
  if (filters.length === 0) {
    return PrismaRaw.empty;
  }

  return PrismaRaw.sql`WHERE ${PrismaRaw.join(filters, " AND ")}`;
}

/**
 * Keyset pagination on `(consumedAt, id)`, the same pair the list orders by.
 * Both are immutable once the ledger row exists, so a page boundary cannot
 * move under a client and "Load more" can neither duplicate nor skip a row.
 */
export async function findTransactionHistoryPage(
  params: BuildTransactionHistoryParams,
  pagination: { cursor?: string; take: number },
  prismaClient: TransactionHistoryPrismaClient = params.billingScope.networkDb,
): Promise<{ rows: TransactionHistoryRow[]; hasMore: boolean }> {
  const filters = buildFilterSql(params);

  if (pagination.cursor) {
    filters.push(PrismaRaw.sql`
      (ledger."consumedAt", ledger."id") < (
        SELECT c."createdAt", c."id"
        FROM ${params.billingScope.networkTable("Transaction")} AS c
        WHERE c."id" = ${pagination.cursor}
      )
    `);
  }

  const takePlusOne = pagination.take + 1;
  const rows = await prismaClient.$queryRaw<TransactionHistoryRow[]>`
    SELECT
      ledger."id",
      ledger."consumedAt",
      ledger."amount",
      ledger."kind",
      ledger."userId",
      ledger."projectId",
      ledger."jobId",
      ledger."jobName",
      ledger."agentId",
      ledger."imageJobId",
      ledger."imageModel",
      ledger."imagePrompt",
      ledger."taskId",
      ledger."taskName",
      ledger."taskArchived",
      ledger."taskEventId",
      ledger."taskEventComment",
      ledger."coworkerId",
      ledger."coworkerName",
      ledger."sokoBotId",
      ledger."sokoBotName",
      ledger."sokoBotTurnSource",
      ledger."sokoBotScheduleName",
      ledger."sokoBotScheduleKey",
      ledger."contactListId",
      ledger."contactListName",
      ledger."contactFound",
      ledger."contactName",
      ledger."bucketSource",
      ledger."topUpSource",
      ledger."topUpNote",
      ledger."refundedJobId",
      ledger."refundedJobName",
      ledger."refundedAgentId",
      ledger."refundedJobOnChainStatus",
      ledger."refundedTaskId",
      ledger."refundedTaskName",
      ledger."refundedTaskArchived",
      ledger."refundedImagePrompt",
      ledger."refundSource",
      ledger."refundX402Kind"
    FROM (${buildLedgerSql(params)}) AS ledger
    ${buildWhereSql(filters)}
    ORDER BY ledger."consumedAt" DESC, ledger."id" DESC
    LIMIT ${takePlusOne}
  `;

  return {
    rows: rows.slice(0, pagination.take),
    hasMore: rows.length === takePlusOne,
  };
}

export async function countTransactionHistory(
  params: BuildTransactionHistoryParams,
  prismaClient: TransactionHistoryPrismaClient = params.billingScope.networkDb,
): Promise<number> {
  const rows = await prismaClient.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::BIGINT AS "count"
    FROM (${buildLedgerSql(params)}) AS ledger
    ${buildWhereSql(buildFilterSql(params))}
  `;

  return Number(rows[0]?.count ?? 0n);
}

/**
 * Net credits taken by the rows under the filters: spends minus refunds and
 * other top ups. Positive means credits were spent.
 */
export async function sumTransactionHistory(
  params: BuildTransactionHistoryParams,
  prismaClient: TransactionHistoryPrismaClient = params.billingScope.networkDb,
): Promise<{ credits: number; count: number }> {
  const rows = await prismaClient.$queryRaw<
    Array<{ count: bigint; net: bigint | null }>
  >`
    SELECT
      COUNT(*)::BIGINT AS "count",
      SUM(-ledger."amount")::BIGINT AS "net"
    FROM (${buildLedgerSql(params)}) AS ledger
    ${buildWhereSql(buildFilterSql(params))}
  `;

  return {
    credits: convertCentsToCredits(rows[0]?.net ?? 0n),
    count: Number(rows[0]?.count ?? 0n),
  };
}

/**
 * Credits spent per UTC day. Top ups are not spend and are left out. Days with
 * no spend are absent; the caller fills the gaps for the range it asked for.
 */
export async function findTransactionDailySpend(
  params: BuildTransactionHistoryParams,
  prismaClient: TransactionHistoryPrismaClient = params.billingScope.networkDb,
): Promise<Array<{ date: string; credits: number }>> {
  const rows = await prismaClient.$queryRaw<
    Array<{ day: string; spent: bigint }>
  >`
    SELECT
      TO_CHAR(ledger."consumedAt", 'YYYY-MM-DD') AS "day",
      SUM(-ledger."amount")::BIGINT AS "spent"
    FROM (${buildLedgerSql(params)}) AS ledger
    ${buildWhereSql([...buildFilterSql(params), PrismaRaw.sql`ledger."amount" < 0`])}
    GROUP BY 1
    ORDER BY 1
  `;

  return rows.map((row) => ({
    date: row.day,
    credits: convertCentsToCredits(row.spent),
  }));
}

export function organizationSpendByUser(
  scope: NetworkScope,
  organizationId: string,
  from: Date,
  to?: Date,
) {
  const spendWhere = {
    organizationId,
    amount: { lt: 0n },
    createdAt: { gte: from, ...(to ? { lt: to } : {}) },
  };
  return scope.networkDb.transaction.groupBy({
    by: ["userId"],
    where: spendWhere,
    _sum: { amount: true },
  });
}
