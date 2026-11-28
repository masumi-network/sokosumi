import { TaskVisibility } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable, sharedType } from "@sokosumi/database/sql-tables";
import {
  buildHumanTaskVisibilitySql,
  type SokoBotTurnReader,
} from "@/helpers/task-visibility";
import type { Network } from "@/lib/network";

/** The split-layout form of the turn reader's Job predicate. */
export function buildSokoBotReaderJobVisibilitySql(
  reader: SokoBotTurnReader,
  network: Network,
): PrismaRaw.Sql {
  const { sql, empty } = PrismaRaw;
  const publicTask = sql`AND t.visibility = ${TaskVisibility.PUBLIC}::${sharedType("TaskVisibility")}`;
  if (reader.sharedScope) {
    const { workspaceId, sokoBotId, projectId } = reader.sharedScope;
    const project =
      projectId === null ? empty : sql`AND t."projectId" = ${projectId}::uuid`;
    return sql`
      AND j."workspaceId" = ${workspaceId}::uuid
      AND (
        EXISTS (
          SELECT 1 FROM ${sharedTable("soko_bot_delegation")} d
          JOIN ${sharedTable("soko_bot_turn")} turn ON turn.id = d."turnId"
          WHERE d."jobId" = j.id AND d.network = ${network}
            AND turn."sokoBotId" = ${sokoBotId}::uuid
        )
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("task")} t
          WHERE t.id = j."taskId" AND t."workspaceId" = ${workspaceId}::uuid
            ${publicTask} ${project}
        )
      )
    `;
  }
  const visibleTask =
    reader.audience === "OWNER"
      ? buildHumanTaskVisibilitySql(reader.userId)
      : publicTask;
  return sql`
    AND j."ownerId" = ${reader.userId}
    AND (
      j."taskId" IS NULL OR EXISTS (
        SELECT 1 FROM ${sharedTable("task")} t
        WHERE t.id = j."taskId" ${visibleTask}
      )
    )
  `;
}
