import { formatTaskIdentifier } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import type prisma from "@/lib/db/prisma";

type Db = Pick<typeof prisma, "task">;

/** The Tasks above a sub-task, root first. Empty for a Task on the board. */
export async function loadTaskAncestors(parentTaskId: string | null, db: Db) {
  const ancestors = [];
  let nextId = parentTaskId;
  while (nextId && ancestors.length < LIMITS.MAX_SUBTASK_DEPTH) {
    const row = await db.task.findUnique({
      where: { id: nextId },
      select: {
        id: true,
        name: true,
        status: true,
        number: true,
        parentTaskId: true,
        project: { select: { identifier: true } },
      },
    });
    if (!row) break;
    ancestors.unshift({
      id: row.id,
      identifier: formatTaskIdentifier(row.project?.identifier, row.number),
      name: row.name,
      status: row.status,
    });
    nextId = row.parentTaskId;
  }
  return ancestors;
}
