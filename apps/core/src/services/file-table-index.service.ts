import {
  FileExtractionState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { normalizeFileResourceName } from "@sokosumi/utils";

import {
  queryTableRows,
  requireDataTable,
  type TableActor,
} from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import { writeVersionChunks } from "@/services/file-index.service";

/**
 * Making a native table searchable by what is in it.
 *
 * ## Every read goes through the table gate
 *
 * Rows are never read from `table_row` directly here, and the sequence
 * index is never used as a shortcut. The only two doors are
 * `requireDataTable`, which binds the table to a workspace and runs
 * `scopeForTask`, and `queryTableRows`, which re-runs both and applies the
 * task scope to the row set. A mistake in this file leaks another
 * workspace's table contents into search results, so it has no path that
 * could make one.
 *
 * ## Who can then see the text
 *
 * Indexing is not authorization. A `NATIVE_TABLE` resource is readable only
 * through the arm added to `buildAuthorizedResourceSql`, which admits an
 * **interactive** actor whose workspace still owns a live table. Coworker
 * and Soko Bot actors are excluded there, deliberately: those are exactly
 * the actors `scopeForTask` narrows to one task's rows, and a whole-table
 * index cannot express that narrowing. Fail closed rather than approximate.
 *
 * ## How a row becomes text
 *
 * One line per row, `Column: value` joined by ` · `. A reader searching for
 * a value finds the row, and the snippet reads as a row rather than as a
 * JSON blob. Empty cells are dropped so a sparse table does not index as a
 * wall of column names.
 */

/** Rows read per table. A table can dwarf any document. */
export const TABLE_INDEX_MAX_ROWS = 2_000;
/** Characters kept per table, matching the document extraction budget. */
export const TABLE_INDEX_MAX_CHARS = 1_000_000;
/**
 * One page of the authorized row query.
 *
 * 100 because that is the ceiling `tableQuerySchema` enforces — the gate
 * has its own bounds and this reader lives inside them rather than around
 * them. Asking for 200 is rejected, which is the schema doing its job.
 */
const TABLE_INDEX_PAGE_SIZE = 100;

export interface TableIndexResult {
  resourceId: string;
  rowsIndexed: number;
  rowsTotal: number;
  state: FileExtractionState;
  coverage: number;
}

/** `Column: value · Column: value`, skipping empties. */
export function renderTableRow(
  columns: { id: string; name: string }[],
  values: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const column of columns) {
    const value = values[column.id];
    if (value === null || value === undefined || value === "") continue;
    const rendered = Array.isArray(value)
      ? value.filter((entry) => entry !== null && entry !== "").join(", ")
      : String(value);
    if (rendered.trim().length === 0) continue;
    parts.push(`${column.name}: ${rendered}`);
  }
  return parts.join(" · ");
}

/**
 * Index one table's rows, through the authorized readers only.
 *
 * The actor is the caller's, not a synthetic one: whatever `requireDataTable`
 * and `scopeForTask` would refuse for them is refused here too.
 */
export async function indexDataTable(
  actor: TableActor,
  tableId: string,
): Promise<TableIndexResult> {
  // Door one. Throws `notFound` for a table outside this workspace.
  const table = await requireDataTable(actor, tableId);
  const columns = [...table.columns]
    .sort((left, right) => left.position - right.position)
    .map((column) => ({ id: column.id, name: column.name }));

  const lines: string[] = [];
  let characters = 0;
  let rowsIndexed = 0;
  let rowsTotal = 0;
  let cursor: string | null = null;
  let truncated = false;

  for (;;) {
    // Door two. Re-runs the gate and applies the task scope to the rows.
    const page: Awaited<ReturnType<typeof queryTableRows>> =
      await queryTableRows(actor, tableId, {
        limit: TABLE_INDEX_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
    rowsTotal = page.total;

    for (const row of page.rows) {
      if (rowsIndexed >= TABLE_INDEX_MAX_ROWS) {
        truncated = true;
        break;
      }
      const line = renderTableRow(
        columns,
        (row.values ?? {}) as Record<string, unknown>,
      );
      if (line.length === 0) {
        rowsIndexed += 1;
        continue;
      }
      if (characters + line.length > TABLE_INDEX_MAX_CHARS) {
        truncated = true;
        break;
      }
      lines.push(line);
      characters += line.length + 1;
      rowsIndexed += 1;
    }

    if (truncated || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  if (rowsTotal > rowsIndexed) truncated = true;

  const owner = await resolveWorkspaceOwner(actor.workspaceId);
  const resourceId = await upsertTableResource({
    workspaceId: actor.workspaceId,
    tableId,
    displayName: table.title,
    owner,
  });

  const text = lines.join("\n");
  const coverage = rowsTotal === 0 ? 1 : Math.min(1, rowsIndexed / rowsTotal);
  const state = truncated
    ? FileExtractionState.PARTIAL
    : FileExtractionState.INDEXED;

  const version = await prisma.fileVersion.upsert({
    where: {
      resourceId_revision: { resourceId, revision: 1 },
    },
    create: {
      resourceId,
      revision: 1,
      objectKey: `table:${tableId}`,
      mimeType: "text/plain",
      sizeBytes: text.length,
      extractionState: state,
      extractionCoverage: coverage,
      extractionReason: truncated
        ? "Only part of this table is indexed; it is larger than the indexing budget."
        : null,
    },
    update: {
      sizeBytes: text.length,
      extractionState: state,
      extractionCoverage: coverage,
      extractionReason: truncated
        ? "Only part of this table is indexed; it is larger than the indexing budget."
        : null,
    },
    select: { id: true },
  });

  const scope = await ensureEvidenceScope({
    workspaceId: actor.workspaceId,
    sourceKind: FileSourceKind.NATIVE_TABLE,
    sourceScope: owner.sourceScope,
    sourceId: tableId,
  });

  // Replace rather than append: a table's text is a snapshot of its rows.
  await prisma.fileChunk.deleteMany({ where: { versionId: version.id } });
  if (text.length > 0) {
    await writeVersionChunks({
      versionId: version.id,
      evidenceScopeId: scope.id,
      scopeVersion: scope.scopeVersion,
      chunks: chunkExtractedText(text),
    });
  }

  return { resourceId, rowsIndexed, rowsTotal, state, coverage };
}

interface WorkspaceOwner {
  sourceScope: FileSourceScope;
  ownerUserId: string | null;
  ownerOrganizationId: string | null;
}

/**
 * A table belongs to a workspace, and a workspace belongs to a person or an
 * organization. `FileSourceScope` has no `WORKSPACE` member and this is not
 * the change to add one, so the resource records the workspace's owner the
 * same way a Drive resource does. Nothing authorizes on it — the arm in
 * `buildAuthorizedResourceSql` joins `data_table` on the workspace — it is
 * here so the row says truthfully whose table this is.
 */
async function resolveWorkspaceOwner(
  workspaceId: string,
): Promise<WorkspaceOwner> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (workspace?.organizationId) {
    return {
      sourceScope: FileSourceScope.ORGANIZATION,
      ownerUserId: null,
      ownerOrganizationId: workspace.organizationId,
    };
  }
  return {
    sourceScope: FileSourceScope.USER,
    ownerUserId: workspace?.userId ?? null,
    ownerOrganizationId: null,
  };
}

async function upsertTableResource(input: {
  workspaceId: string;
  tableId: string;
  displayName: string;
  owner: WorkspaceOwner;
}): Promise<string> {
  const existing = await prisma.fileResource.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.workspaceId,
        sourceKind: FileSourceKind.NATIVE_TABLE,
        sourceScope: input.owner.sourceScope,
        sourceId: input.tableId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.fileResource.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName,
        normalizedName: normalizeFileResourceName(input.displayName),
        lifecycle: FileResourceLifecycle.ACTIVE,
        tombstonedAt: null,
        contentRevision: 1,
        metadataRevision: { increment: 1 },
      },
    });
    return existing.id;
  }

  const created = await prisma.fileResource.create({
    data: {
      workspaceId: input.workspaceId,
      sourceKind: FileSourceKind.NATIVE_TABLE,
      sourceScope: input.owner.sourceScope,
      sourceId: input.tableId,
      ownerUserId: input.owner.ownerUserId,
      ownerOrganizationId: input.owner.ownerOrganizationId,
      displayName: input.displayName,
      normalizedName: normalizeFileResourceName(input.displayName),
      mimeType: "text/plain",
      lifecycle: FileResourceLifecycle.ACTIVE,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Indexing the tables that have actually changed.
 *
 * `TableChange` is #4747's append-only log: one row per mutation, with a
 * monotonic `sequence` and a `(tableId, sequence)` index. A table is stale
 * exactly when its `MAX(sequence)` exceeds the value its catalog row was
 * built from, which makes staleness a cheap index-only lookup rather than a
 * re-read of every table.
 *
 * Verified against a real database before being relied on, because a
 * staleness signal that goes backwards or stops would leave a stale index
 * looking fresh:
 *
 * - **Monotonic per table.** Consecutive mutations produced 27, 28, 29, 30.
 *   The sequence is a global autoincrement, so per table it is monotonic but
 *   not contiguous; gaps are other tables' changes, never lost ones.
 * - **Written for every row mutation**, not some. Insert, patch and row
 *   archive each advanced it, as did archiving the table itself.
 * - **The index is used.** `EXPLAIN` on `MAX(sequence)` filtered by
 *   `tableId` gives `Index Only Scan Backward using
 *   table_change_tableId_sequence_idx`.
 * - **Deletion advances it rather than losing it.** Rows are soft-deleted
 *   through `archivedAt`, and that archive is itself a logged change, so a
 *   deletion makes a table *more* stale rather than silently leaving the
 *   old text indexed. A hard-deleted table cascades its log away, but then
 *   the authorized arm's `EXISTS (data_table …)` hides the resource anyway.
 */

export interface TableSyncResult {
  scanned: number;
  indexed: number;
  failed: number;
}

interface StaleTable {
  tableId: string;
  workspaceId: string;
  ownerUserId: string | null;
  latest: bigint;
}

/** Tables whose newest change is past what the catalog last indexed. */
async function findStaleTables(limit: number): Promise<StaleTable[]> {
  return prisma.$queryRaw<StaleTable[]>(PrismaRaw.sql`
    SELECT
      dt.id AS "tableId",
      dt."workspaceId",
      w."userId" AS "ownerUserId",
      latest.sequence AS "latest"
    FROM data_table dt
    JOIN workspace w ON w.id = dt."workspaceId"
    JOIN LATERAL (
      SELECT MAX(tc.sequence) AS sequence
      FROM table_change tc
      WHERE tc."tableId" = dt.id
    ) latest ON TRUE
    LEFT JOIN file_resource fr
      ON fr."workspaceId" = dt."workspaceId"
      AND fr."sourceKind" = 'NATIVE_TABLE'::"FileSourceKind"
      AND fr."sourceId" = dt.id::text
    WHERE dt."archivedAt" IS NULL
      AND latest.sequence IS NOT NULL
      AND (fr.id IS NULL OR fr."sourceSequence" IS DISTINCT FROM latest.sequence)
    ORDER BY latest.sequence ASC
    LIMIT ${limit}
  `);
}

/**
 * Index every table whose contents have moved since it was last indexed.
 *
 * The actor is `user`-kind on purpose. That is not a claim about a person:
 * it is the kind that is *not* narrowed by `scopeForTask`, and a whole-table
 * index is exactly the un-narrowed view. The readers who could see a
 * narrowed one — coworker and Soko Bot — are excluded from table content in
 * `buildAuthorizedResourceSql`, so nothing is widened by this. Indexing
 * writes no `TableChange`, so no actor identity is recorded anywhere.
 */
export async function processStaleTableIndexes(input: {
  shouldContinue: () => boolean;
  maxTables?: number;
}): Promise<TableSyncResult> {
  const maxTables = input.maxTables ?? 20;
  const result: TableSyncResult = { scanned: 0, indexed: 0, failed: 0 };

  const stale = await findStaleTables(maxTables);

  for (const table of stale) {
    if (!input.shouldContinue()) break;
    result.scanned += 1;

    try {
      await indexDataTable(
        {
          workspaceId: table.workspaceId,
          userId: table.ownerUserId ?? "",
          actorId: "system:file-table-index",
          actorKind: "user",
        },
        table.tableId,
      );
      await prisma.fileResource.updateMany({
        where: {
          workspaceId: table.workspaceId,
          sourceKind: FileSourceKind.NATIVE_TABLE,
          sourceId: table.tableId,
        },
        data: { sourceSequence: table.latest },
      });
      result.indexed += 1;
    } catch {
      // One unreadable table must not stop the sweep, and it stays stale so
      // the next run tries again rather than recording a fresh-looking index.
      result.failed += 1;
    }
  }

  return result;
}
