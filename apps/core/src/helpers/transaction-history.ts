import { PrismaRaw } from "@sokosumi/database/client";
import { convertCentsToCredits } from "@sokosumi/utils";
import type { AgentPreview, UserPreview } from "@/helpers/history";
import type prisma from "@/lib/db/prisma";
import { findImageModelForEndpoint } from "@/lib/image-studio/catalog";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import type {
  TransactionHistoryItem,
  TransactionHistoryKind,
} from "@/schemas/transaction-history.schema";

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
  taskEventId: string | null;
  taskEventComment: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  sokoBotId: string | null;
  sokoBotName: string | null;
  sokoBotTurnSource: string | null;
  sokoBotScheduleName: string | null;
  sokoBotScheduleKey: string | null;
  bucketSource: string | null;
  topUpSource: string | null;
  topUpNote: string | null;
}

export interface BuildTransactionHistoryParams {
  /** Inclusive lower bound on `consumedAt`. */
  from?: Date;
  /** Exclusive upper bound on `consumedAt`. */
  to?: Date;
  kinds?: TransactionHistoryKind[];
  projectId?: string | null;
  q?: string;
  scope: "owned" | "workspace";
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
const KIND_CASE = PrismaRaw.sql`
  CASE
    WHEN t."amount" > 0 THEN 'topUp'
    WHEN j."id" IS NOT NULL THEN 'job'
    WHEN pij."id" IS NOT NULL THEN 'image'
    WHEN te."id" IS NOT NULL THEN 'task'
    WHEN cu."id" IS NOT NULL THEN 'coworker'
    WHEN sbu."id" IS NOT NULL THEN 'sokoBot'
    ELSE 'unattributed'
  END
`;

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

  return filters;
}

/**
 * The ledger projection: one row per transaction, labelled by whatever links to
 * it. Selected as a subquery so the computed `kind`, `projectId` and
 * `searchText` are filterable without repeating their expressions.
 */
function buildLedgerSql(params: BuildTransactionHistoryParams): PrismaRaw.Sql {
  return PrismaRaw.sql`
    SELECT
      t."id",
      t."createdAt" AS "consumedAt",
      t."amount",
      t."userId",
      ${KIND_CASE} AS "kind",
      COALESCE(j."projectId", pij."projectId", tk."projectId") AS "projectId",
      j."id" AS "jobId",
      j."name" AS "jobName",
      j."agentId" AS "agentId",
      pij."id"::TEXT AS "imageJobId",
      pij."model" AS "imageModel",
      pij."prompt" AS "imagePrompt",
      te."taskId" AS "taskId",
      tk."name" AS "taskName",
      te."id" AS "taskEventId",
      te."comment" AS "taskEventComment",
      cu."coworkerId" AS "coworkerId",
      cw."name" AS "coworkerName",
      sbu."sokoBotId"::TEXT AS "sokoBotId",
      sb."name" AS "sokoBotName",
      sbt."source"::TEXT AS "sokoBotTurnSource",
      sbs."name" AS "sokoBotScheduleName",
      sbs."systemKey" AS "sokoBotScheduleKey",
      bucket."referenceType" AS "bucketSource",
      topup."referenceType"::TEXT AS "topUpSource",
      topup."referenceNote" AS "topUpNote",
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
        topup."referenceType"::TEXT,
        topup."referenceNote"
      ) AS "searchText"
    FROM "Transaction" AS t
    LEFT JOIN "Job" AS j ON j."transactionId" = t."id"
    LEFT JOIN "Agent" AS a ON a."id" = j."agentId"
    LEFT JOIN "project_image_job" AS pij ON pij."transactionId" = t."id"
    -- TaskEvent is one-to-many on the schema even though mainnet has exactly
    -- one per charging transaction, so pick a stable single row.
    LEFT JOIN LATERAL (
      SELECT e."id", e."taskId", e."comment"
      FROM "taskEvent" AS e
      WHERE e."transactionId" = t."id"
      ORDER BY e."createdAt" ASC, e."id" ASC
      LIMIT 1
    ) AS te ON TRUE
    LEFT JOIN "task" AS tk ON tk."id" = te."taskId"
    LEFT JOIN "coworker_usage" AS cu ON cu."transactionId" = t."id"
    LEFT JOIN "coworker" AS cw ON cw."id" = cu."coworkerId"
    LEFT JOIN "soko_bot_usage" AS sbu ON sbu."transactionId" = t."id"
    LEFT JOIN "soko_bot" AS sb ON sb."id" = sbu."sokoBotId"
    -- A usage row's reference is the turn it billed.
    LEFT JOIN "soko_bot_turn" AS sbt ON sbt."id"::TEXT = sbu."referenceId"
    LEFT JOIN "soko_bot_schedule_run" AS sbr ON sbr."turnId" = sbt."id"
    LEFT JOIN "soko_bot_schedule" AS sbs ON sbs."id" = sbr."scheduleId"
    -- A spend can draw from several buckets. One is enough to name a source.
    LEFT JOIN LATERAL (
      SELECT b."referenceType"::TEXT AS "referenceType"
      FROM "credit_consumption" AS cc
      JOIN "credit_bucket" AS b ON b."id" = cc."bucketId"
      WHERE cc."transactionId" = t."id"
      ORDER BY cc."createdAt" ASC, cc."id" ASC
      LIMIT 1
    ) AS bucket ON TRUE
    -- The bucket a top up created. One-to-one with the transaction that paid
    -- for it, so this is a plain join rather than a lateral pick.
    LEFT JOIN "credit_bucket" AS topup ON topup."sourceTransactionId" = t."id"
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
  prismaClient: TransactionHistoryPrismaClient,
): Promise<{ rows: TransactionHistoryRow[]; hasMore: boolean }> {
  const filters = buildFilterSql(params);

  if (pagination.cursor) {
    filters.push(PrismaRaw.sql`
      (ledger."consumedAt", ledger."id") < (
        SELECT c."createdAt", c."id"
        FROM "Transaction" AS c
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
      ledger."taskEventId",
      ledger."taskEventComment",
      ledger."coworkerId",
      ledger."coworkerName",
      ledger."sokoBotId",
      ledger."sokoBotName",
      ledger."sokoBotTurnSource",
      ledger."sokoBotScheduleName",
      ledger."sokoBotScheduleKey",
      ledger."bucketSource",
      ledger."topUpSource",
      ledger."topUpNote"
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
  prismaClient: TransactionHistoryPrismaClient,
): Promise<number> {
  const rows = await prismaClient.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::BIGINT AS "count"
    FROM (${buildLedgerSql(params)}) AS ledger
    ${buildWhereSql(buildFilterSql(params))}
  `;

  return Number(rows[0]?.count ?? 0n);
}

/**
 * Credits spent per UTC day. Top ups are not spend and are left out. Days with
 * no spend are absent; the caller fills the gaps for the range it asked for.
 */
export async function findTransactionDailySpend(
  params: BuildTransactionHistoryParams,
  prismaClient: TransactionHistoryPrismaClient,
): Promise<Array<{ date: string; credits: number }>> {
  const rows = await prismaClient.$queryRaw<
    Array<{ day: string; spent: bigint }>
  >`
    SELECT
      TO_CHAR(ledger."consumedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
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

export interface MapTransactionHistoryRowOptions {
  agentPreviewById?: Map<string, AgentPreview>;
  userPreviewById?: Map<string, UserPreview>;
}

/**
 * A top up is named by the bucket it created. `CreditBucketReferenceType` is
 * the only thing that distinguishes a purchase from a refund or a plan grant,
 * and `referenceNote` carries the free-text detail when there is one.
 */
const TOP_UP_TITLE_BY_SOURCE: Record<string, string> = {
  STRIPE_TOPUP: "Credit top up",
  STRIPE_FREE: "Free credits",
  STRIPE_SUBSCRIPTION_PERIOD: "Subscription credits",
  REFUND: "Refund",
  ENTERPRISE_PERIOD: "Enterprise plan credits",
  ENTERPRISE_TOP_UP: "Enterprise top up",
  SIGNUP_BONUS: "Signup bonus",
  FREE: "Free credits",
};

/** A prompt is a paragraph; a list row is a line. */
function truncate(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}

const SOKO_BOT_SYSTEM_SCHEDULE_LABELS: Record<string, string> = {
  standup: "Daily stand-up",
  "weekly-wrap": "Weekly wrap",
  "meeting-prep": "Meeting prep",
  "end-of-day": "End of day",
  "follow-ups": "Follow-up check",
  "monday-plan": "Monday plan",
  "monthly-review": "Monthly review",
  "memory-cleanup": "Memory cleanup",
};

const SOKO_BOT_SOURCE_LABELS: Record<string, string> = {
  CHAT: "Chat",
  INGEST: "Inbox and calendar check",
  EVENT: "Task update",
  ADMIN_RETRY: "Retry",
};

/** What a billed turn was for, from its source and schedule. */
function sokoBotTurnLabel(row: TransactionHistoryRow): string | null {
  if (row.sokoBotTurnSource === "SCHEDULE") {
    const key = row.sokoBotScheduleKey ?? "";
    const named = row.sokoBotScheduleName
      ? `Scheduled: ${row.sokoBotScheduleName}`
      : "Scheduled";
    return SOKO_BOT_SYSTEM_SCHEDULE_LABELS[key] ?? named;
  }
  return SOKO_BOT_SOURCE_LABELS[row.sokoBotTurnSource ?? ""] ?? null;
}

export function mapTransactionHistoryRow(
  row: TransactionHistoryRow,
  options?: MapTransactionHistoryRowOptions,
): TransactionHistoryItem {
  const userPreview = row.userId
    ? options?.userPreviewById?.get(row.userId)
    : undefined;
  const base = {
    id: row.id,
    // `Transaction.amount` is signed: negative is a spend, positive is a top
    // up. Report the magnitude and let `kind` carry the direction, so no
    // caller has to know the sign convention to render a number.
    credits: convertCentsToCredits(row.amount < 0n ? -row.amount : row.amount),
    consumedAt: row.consumedAt.toISOString(),
    projectId: row.projectId,
    owner: userPreview
      ? {
          userId: userPreview.userId,
          name: userPreview.name,
          image: userPreview.image,
        }
      : null,
  };

  switch (row.kind) {
    case "job": {
      const agentPreview = row.agentId
        ? options?.agentPreviewById?.get(row.agentId)
        : undefined;
      return {
        ...base,
        kind: "job",
        title: row.jobName ?? agentPreview?.name ?? "Agent job",
        description: agentPreview?.name ?? null,
        jobId: row.jobId ?? "",
        agentId: row.agentId,
        agentName: agentPreview?.name ?? null,
        agentIcon: agentPreview?.icon ?? null,
      };
    }
    case "image": {
      // The catalog is the authority on a model's display name and it is live,
      // so this resolves at read time. A model fal has since withdrawn falls
      // back to the endpoint, which is still true about the image.
      const endpoint = row.imageModel ?? "";
      const modelLabel =
        findImageModelForEndpoint(endpoint)?.label ??
        // A model the catalog no longer lists. The endpoint still names what
        // made the image, which is more use than "Unknown model".
        (endpoint.replace(/^[^/]+\//, "") || "Unknown model");
      return {
        ...base,
        kind: "image",
        title: row.imagePrompt ? truncate(row.imagePrompt) : modelLabel,
        description: modelLabel,
        imageJobId: row.imageJobId ?? "",
        modelLabel,
      };
    }
    case "task":
      return {
        ...base,
        kind: "task",
        title: row.taskName ?? "Task",
        description: row.taskEventComment
          ? truncate(row.taskEventComment)
          : null,
        taskId: row.taskId ?? "",
        taskEventId: row.taskEventId ?? "",
      };
    case "coworker":
      return {
        ...base,
        kind: "coworker",
        title: row.coworkerName ?? "Coworker usage",
        description: null,
        coworkerId: row.coworkerId ?? "",
      };
    case "sokoBot":
      return {
        ...base,
        kind: "sokoBot",
        title: `Soko Bot · ${row.sokoBotName?.trim() || "Unnamed"}`,
        description: sokoBotTurnLabel(row),
        sokoBotId: row.sokoBotId ?? "",
      };
    case "topUp":
      return {
        ...base,
        kind: "topUp",
        title: TOP_UP_TITLE_BY_SOURCE[row.topUpSource ?? ""] ?? "Top up",
        description: row.topUpNote ? truncate(row.topUpNote) : null,
        bucketSource: row.topUpSource,
      };
    case "unattributed":
      // Nothing links this spend to an entity. Say so plainly: the date, the
      // amount and the bucket it drew from are everything that is known, and
      // inventing a source would be worse than an honest blank.
      return {
        ...base,
        kind: "unattributed",
        title: "Credit consumption",
        description: null,
        bucketSource: row.bucketSource,
      };
  }
}
