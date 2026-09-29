import type { Prisma } from "@sokosumi/database";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Trailing text after the number is a URL slug and is ignored.
const IDENTIFIER_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,6})-(\d{1,9})(?:-.*)?$/;

export type TaskRef =
  | { kind: "id"; id: string }
  | { kind: "identifier"; prefix: string; number: number };

/**
 * Reads a task path segment as a UUID or a project identifier such as
 * `SOK-12` or `sok-12-some-slug`. Null means neither, so callers treat the
 * raw segment as an id as before.
 */
export function parseTaskRef(ref: string): TaskRef | null {
  if (UUID_PATTERN.test(ref)) {
    return { kind: "id", id: ref };
  }
  const match = IDENTIFIER_PATTERN.exec(ref);
  if (!match) {
    return null;
  }
  return {
    kind: "identifier",
    prefix: match[1]!.toUpperCase(),
    number: Number(match[2]),
  };
}

/**
 * Maps a task path segment to a task id inside one workspace: the project
 * with that identifier, then the task holding that number, then the alias
 * left by a task that moved away. Unresolvable refs come back unchanged, so
 * the caller's normal lookup produces its usual 404 and identifiers cannot
 * be used to probe for tasks the caller cannot see. Access checks stay with
 * the caller.
 */
export async function resolveTaskRefToId(
  ref: string,
  workspaceId: string,
  db: Pick<
    Prisma.TransactionClient,
    "project" | "task" | "taskIdentifierAlias"
  >,
): Promise<string> {
  const parsed = parseTaskRef(ref);
  if (parsed?.kind !== "identifier") {
    return ref;
  }
  const project = await db.project.findUnique({
    where: {
      workspaceId_identifier: { workspaceId, identifier: parsed.prefix },
    },
    select: { id: true },
  });
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
