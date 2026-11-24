import { CURATED_VOCABULARY_VERSION, TASK_TAG_PRESETS } from "@sokosumi/utils";
import { Prisma } from "../generated/prisma/client.js";
import { sharedTable } from "../sql-tables.js";

/** Each statement seeds at most 500 workspaces so a retry can resume after a committed batch. */
const WORKSPACES_PER_BATCH = 500;

export async function backfillTaskWorkTypePresets(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  { dryRun = false, batchSize = WORKSPACES_PER_BATCH } = {},
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("batchSize must be a positive integer");
  }
  const presets = Prisma.join(
    TASK_TAG_PRESETS.map(
      (row) => Prisma.sql`(
    ${row.kind}::"FileLabelKind", ${row.displayName}::text,
    ${row.normalizedName}::text, ${row.description}::text
  )`,
    ),
  );
  let after: string | null = null;
  let total = 0;
  for (;;) {
    // New workspaces seed in their creation transaction. An existing marker means the
    // workspace already received its presets, including ones its members later renamed.
    const [result]: { cursor: string | null; count: number }[] =
      await db.$queryRaw`
      WITH batch AS (
        SELECT w.id FROM ${sharedTable("workspace")} w
        WHERE ${after ? Prisma.sql`w.id > ${after}::uuid AND` : Prisma.empty}
          NOT EXISTS (
            SELECT 1 FROM ${sharedTable("workspace_label")} seeded
            WHERE seeded."workspaceId" = w.id AND seeded."isTaskPreset"
          )
        ORDER BY w.id LIMIT ${batchSize}
      ), missing AS (
        SELECT b.id AS "workspaceId", p.* FROM batch b
        CROSS JOIN (VALUES ${presets}) p(kind, "displayName", "normalizedName", description)
        WHERE NOT EXISTS (
          SELECT 1 FROM ${sharedTable("workspace_label")} existing
          WHERE existing."workspaceId" = b.id AND existing.kind = p.kind
            AND existing."normalizedName" = p."normalizedName"
        )
      ), affected AS (
        ${
          dryRun
            ? Prisma.sql`SELECT 1 FROM missing`
            : Prisma.sql`
          INSERT INTO ${sharedTable("workspace_label")} (
            id, "createdAt", "updatedAt", "workspaceId", kind, "displayName", "normalizedName",
            description, aliases, "vocabularyVersion", "isTaskPreset", "createdByUserId"
          )
          SELECT gen_random_uuid(), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "workspaceId", kind,
            "displayName", "normalizedName", description, ARRAY[]::text[],
            ${CURATED_VOCABULARY_VERSION}, true, NULL
          FROM missing ORDER BY "workspaceId", "normalizedName"
          ON CONFLICT ("workspaceId", kind, "normalizedName") DO NOTHING
          RETURNING 1`
        }
      )
      SELECT (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS cursor,
             (SELECT count(*)::int FROM affected) AS count
    `;
    total += result.count;
    if (!result.cursor) return total;
    after = result.cursor;
  }
}
