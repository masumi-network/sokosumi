import type { Prisma } from "@sokosumi/database";

import { conflict } from "@/helpers/error";

interface CalendarProjectReadClient {
  project: Pick<Prisma.TransactionClient["project"], "findFirst">;
}

export async function lockCalendarScope(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectIds: Array<string | null | undefined>,
): Promise<boolean> {
  const workspace = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "workspace"
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
      FROM "project"
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

export async function lockTaskRows(
  tx: Prisma.TransactionClient,
  taskIds: string[],
): Promise<boolean> {
  const uniqueTaskIds = [...new Set(taskIds)].sort();
  for (const taskId of uniqueTaskIds) {
    const task = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "task"
      WHERE id = ${taskId}
      FOR UPDATE
    `;
    if (task.length === 0) {
      return false;
    }
  }

  return true;
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
