import type { Prisma } from "@sokosumi/database";
import { parseTaskRef } from "@sokosumi/utils";

/**
 * Maps a task path segment to a task id inside one workspace: the project
 * with that identifier (or a prefix it used to hold), then the task holding
 * that number, then the alias left by a task that moved away. Unresolvable
 * refs come back unchanged, so the caller's normal lookup produces its usual
 * 404 and identifiers cannot be used to probe for tasks the caller cannot
 * see. Access checks stay with the caller.
 */
export async function resolveTaskRefToId(
  ref: string,
  workspaceId: string,
  db: Pick<
    Prisma.TransactionClient,
    "project" | "projectIdentifierAlias" | "task" | "taskIdentifierAlias"
  >,
): Promise<string> {
  const parsed = parseTaskRef(ref);
  if (parsed?.kind !== "identifier") {
    return ref;
  }
  const current = await db.project.findUnique({
    where: {
      workspaceId_identifier: { workspaceId, identifier: parsed.prefix },
    },
    select: { id: true },
  });
  const retired = current
    ? null
    : await db.projectIdentifierAlias.findUnique({
        where: {
          workspaceId_identifier: { workspaceId, identifier: parsed.prefix },
        },
        select: { projectId: true },
      });
  const project = current ?? (retired ? { id: retired.projectId } : null);
  if (!project) {
    return ref;
  }
  const key = { projectId: project.id, number: parsed.number };
  const task = await db.task.findUnique({
    where: { projectId_number: key },
    select: { id: true },
  });
  if (task) {
    return task.id;
  }
  const alias = await db.taskIdentifierAlias.findUnique({
    where: { projectId_number: key },
    select: { taskId: true },
  });
  return alias?.taskId ?? ref;
}
