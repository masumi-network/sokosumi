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
 * A `Transaction` row that took credits, already resolved against every
 * relation that can explain it. Shaped by {@link buildTransactionHistorySql}.
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
  bucketSource: string | null;
}

export interface BuildTransactionHistoryParams {
  kinds?: TransactionHistoryKind[];
  projectId?: string | null;
  q?: string;
  scope: "owned" | "workspace";
  userContext: UserContext;
  workspaceContext: WorkspaceContext;
}

export type TransactionHistoryPrismaClient = Pick<typeof prisma, "$queryRaw">;

/**
 * Attribution is resolved in priority order. `task_payment_claim` and
 * `task_x402_payment` are deliberately absent: on mainnet every transaction
 * they reference also carries the `taskEvent` that charged it, so listing them
 * here would only shadow a better label.
 */
const KIND_CASE = PrismaRaw.sql`
  CASE
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

  if (params.q) {
    filters.push(PrismaRaw.sql`ledger."searchText" ILIKE ${`%${params.q}%`}`);
  }

  return filters;
}

/**
 * The ledger projection: one row per spend, labelled by whatever links to it.
 * Selected as a subquery so the computed `kind`, `projectId` and `searchText`
 * are filterable without repeating their expressions.
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
      bucket."referenceType" AS "bucketSource",
      CONCAT_WS(
        ' ',
        j."name",
        a."name",
        pij."model",
        pij."prompt",
        tk."name",
        te."comment",
        cw."name"
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
    -- A spend can draw from several buckets. One is enough to name a source.
    LEFT JOIN LATERAL (
      SELECT b."referenceType"::TEXT AS "referenceType"
      FROM "credit_consumption" AS cc
      JOIN "credit_bucket" AS b ON b."id" = cc."bucketId"
      WHERE cc."transactionId" = t."id"
      ORDER BY cc."createdAt" ASC, cc."id" ASC
      LIMIT 1
    ) AS bucket ON TRUE
    WHERE t."amount" < 0
      AND ${buildScopeSql(params)}
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
      ledger."bucketSource"
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

export interface MapTransactionHistoryRowOptions {
  agentPreviewById?: Map<string, AgentPreview>;
  userPreviewById?: Map<string, UserPreview>;
}

/** A prompt is a paragraph; a list row is a line. */
function truncate(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
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
    // Ledger spends are negative. The surface talks about credits taken, so
    // report the magnitude and let the label carry the direction.
    credits: convertCentsToCredits(-row.amount),
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
        title: "Soko Bot usage",
        description: null,
        sokoBotId: row.sokoBotId ?? "",
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
