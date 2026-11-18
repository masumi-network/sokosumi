import type { Prisma } from "@sokosumi/database";

import { unprocessableEntity } from "@/helpers/error";

/** The caller holds the Task row lock or just created it in this transaction. */
export async function setTaskWorkspaceTags(
  tx: Prisma.TransactionClient,
  taskId: string,
  workspaceId: string,
  requestedIds: string[],
) {
  const labelIds = [...new Set(requestedIds.map((id) => id.toLowerCase()))];

  if (labelIds.length) {
    // Hold the labels until commit so an archive or merge cannot race a new
    // assignment. An archived label may remain on a Task that already had it.
    const allowed = await tx.$queryRaw<{ id: string }[]>`
      SELECT label.id FROM "workspace_label" label
      WHERE label.id = ANY(${labelIds}::uuid[])
        AND label."workspaceId" = ${workspaceId}::uuid
        AND label.kind = 'TAG' AND label."mergedIntoId" IS NULL
        AND (label."archivedAt" IS NULL OR EXISTS (
          SELECT 1 FROM "task_workspace_tag" assignment
          WHERE assignment."taskId" = ${taskId} AND assignment."labelId" = label.id
        ))
      ORDER BY label.id FOR SHARE
    `;
    if (allowed.length !== labelIds.length) {
      throw unprocessableEntity(
        "One or more workspace tags are unavailable for this Task",
      );
    }
  }

  await tx.taskWorkspaceTag.deleteMany({
    where: { taskId, labelId: { notIn: labelIds } },
  });
  if (labelIds.length) {
    await tx.taskWorkspaceTag.createMany({
      data: labelIds.map((labelId) => ({ taskId, labelId })),
      skipDuplicates: true,
    });
  }
}
