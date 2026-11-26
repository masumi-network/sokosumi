import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict, unprocessableEntity } from "@/helpers/error";
import type { TaskWorkspaceTagSuggestion } from "@/helpers/task-tag-catalog";

/** The Task and its workspace are locked until the PATCH commits. */
export async function requireExpectedTaskWorkspaceTags(
  tx: Prisma.TransactionClient,
  taskId: string,
  expectedIds: string[],
) {
  const expected = new Set(expectedIds.map((id) => id.toLowerCase()));
  const applied = await tx.taskWorkspaceTag.findMany({
    where: { taskId },
    select: { labelId: true },
  });
  if (
    applied.length !== expected.size ||
    applied.some(({ labelId }) => !expected.has(labelId))
  ) {
    throw conflict("Task tags changed. Review the current tags and retry.", {
      kind: CORE_API_ERROR_KINDS.TASK_WORKSPACE_TAGS_CHANGED,
    });
  }
}

/** The caller holds the Task row lock or just created it in this transaction. */
export async function setTaskWorkspaceTags(
  tx: Prisma.TransactionClient,
  taskId: string,
  workspaceId: string,
  requestedIds?: string[],
  dismissedIds: string[] = [],
) {
  const selected = new Set(requestedIds?.map((id) => id.toLowerCase()));
  const dismissed = new Set(dismissedIds.map((id) => id.toLowerCase()));
  // An explicit selection takes precedence over a dismissal in the same request.
  for (const id of selected) dismissed.delete(id);
  const labelIds = [...new Set([...selected, ...dismissed])];

  if (labelIds.length) {
    // Hold the labels until commit so an archive or merge cannot race a new
    // assignment. An archived label may remain on a Task that already had it.
    const allowed = await tx.$queryRaw<{ id: string }[]>`
      SELECT label.id FROM ${sharedTable("workspace_label")} label
      WHERE label.id = ANY(${labelIds}::uuid[])
        AND label."workspaceId" = ${workspaceId}::uuid
        AND label.kind = 'TAG' AND label."mergedIntoId" IS NULL
        AND (label."archivedAt" IS NULL OR EXISTS (
          SELECT 1 FROM ${sharedTable("task_workspace_tag")} assignment
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

  if (requestedIds !== undefined || dismissed.size) {
    const where = {
      taskId,
      labelId:
        requestedIds === undefined
          ? { in: [...dismissed] }
          : { notIn: [...selected] },
    };
    const removed = await tx.taskWorkspaceTag.findMany({
      where,
      select: { labelId: true },
    });
    for (const { labelId } of removed) dismissed.add(labelId);
    await tx.taskWorkspaceTag.deleteMany({ where });
  }

  if (selected.size || dismissed.size) {
    await tx.taskWorkspaceTagDecision.deleteMany({
      where: { taskId, labelId: { in: [...selected, ...dismissed] } },
    });
  }
  if (dismissed.size) {
    await tx.taskWorkspaceTagDecision.createMany({
      data: [...dismissed].map((labelId) => ({
        taskId,
        labelId,
        state: "JEV_DISMISSED" as const,
      })),
    });
  }
  if (selected.size) {
    await tx.taskWorkspaceTag.createMany({
      data: [...selected].map((labelId) => ({ taskId, labelId })),
      skipDuplicates: true,
    });
  }
}

/** The caller locks or creates the Task before applying the model result. */
export async function applyJevWorkspaceTags(
  tx: Prisma.TransactionClient,
  taskId: string,
  workspaceId: string,
  suggestions: readonly TaskWorkspaceTagSuggestion[],
) {
  if (!suggestions.length) return 0;
  // Lock the active labels and ignore stale results or a concurrent human choice.
  const candidates = await tx.$queryRaw<
    { id: string; vocabularyVersion: number }[]
  >`
    SELECT label.id, label."vocabularyVersion" FROM ${sharedTable("workspace_label")} label
    WHERE label.id = ANY(${suggestions.map(({ id }) => id)}::uuid[])
      AND label."workspaceId" = ${workspaceId}::uuid AND label.kind = 'TAG'
      AND label."mergedIntoId" IS NULL AND label."archivedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${sharedTable("task_workspace_tag")} applied
        WHERE applied."taskId" = ${taskId} AND applied."labelId" = label.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${sharedTable("task_workspace_tag_decision")} decision
        WHERE decision."taskId" = ${taskId} AND decision."labelId" = label.id
      )
    ORDER BY label.id FOR SHARE OF label
  `;
  const versions = new Map(
    candidates.map(({ id, vocabularyVersion }) => [id, vocabularyVersion]),
  );
  const eligible = suggestions.filter(
    (s) => versions.get(s.id) === s.vocabularyVersion,
  );
  const applied = eligible.filter((s) => s.autoApply);
  let changed = 0;
  if (applied.length) {
    const inserted = await tx.taskWorkspaceTag.createMany({
      data: applied.map(({ id: labelId }) => ({
        taskId,
        labelId,
        state: "JEV_ADDED" as const,
      })),
      skipDuplicates: true,
    });
    changed += inserted.count;
  }
  const proposed = eligible.filter((s) => !s.autoApply);
  if (proposed.length) {
    const inserted = await tx.taskWorkspaceTagDecision.createMany({
      data: proposed.map(({ id: labelId }) => ({
        taskId,
        labelId,
        state: "JEV_SUGGESTED" as const,
      })),
      skipDuplicates: true,
    });
    changed += inserted.count;
  }
  return changed;
}
