import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { conflict } from "@/helpers/error";

interface CalendarProjectReadClient {
  project: Pick<Prisma.TransactionClient["project"], "findFirst">;
}

type CalendarLockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Lock an interactive actor before any Workspace, Project, or Task row. */
async function lockCalendarActor(
  tx: CalendarLockClient,
  userId: string,
): Promise<boolean> {
  const user = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ${sharedTable("user")}
    WHERE id = ${userId}
    FOR KEY SHARE
  `;
  return user.length === 1;
}

export async function lockCalendarScope(
  tx: CalendarLockClient,
  workspaceId: string,
  projectIds: Array<string | null | undefined>,
  actorUserId?: string,
): Promise<boolean> {
  if (actorUserId && !(await lockCalendarActor(tx, actorUserId))) {
    return false;
  }

  const workspace = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ${sharedTable("workspace")}
    WHERE id = ${workspaceId}::uuid
    FOR UPDATE
  `;
  if (workspace.length === 0) {
    return false;
  }

  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))].sort();
  for (const projectId of uniqueProjectIds) {
    const project = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM ${sharedTable("project")}
      WHERE id = ${projectId}::uuid
        AND "workspaceId" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (project.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Locks Task rows in id order, in one query. False when a row is gone.
 * COLLATE "C" sorts by byte, whatever the database collation, so every
 * caller takes the rows in the same order.
 */
export async function lockTaskRows(
  tx: CalendarLockClient,
  taskIds: string[],
): Promise<boolean> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return true;
  const tasks = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ${sharedTable("task")}
    WHERE id = ANY(${uniqueTaskIds}::text[])
    ORDER BY id COLLATE "C"
    FOR UPDATE
  `;
  return tasks.length === uniqueTaskIds.length;
}

export async function requireOpenCalendarProject(
  tx: CalendarProjectReadClient,
  workspaceId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;

  const project = await tx.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { closingAt: true, closedAt: true },
  });
  if (!project || project.closingAt || project.closedAt) {
    throw conflict("Cannot change a schedule in a closing or closed Project");
  }
}
