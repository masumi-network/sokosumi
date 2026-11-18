import type { Prisma, WorkspaceLabel } from "@sokosumi/database";
import { isUnmodifiedCuratedTag } from "@/helpers/task-tag-catalog";
import { TASK_TAG_IDS } from "@/helpers/task-tags";
import { workspaceLabelSchema } from "@/schemas/file-resource.schema";

export const workspaceLabelSelect = {
  id: true,
  kind: true,
  displayName: true,
  description: true,
  color: true,
  customColor: true,
  archivedAt: true,
  vocabularyVersion: true,
  createdByUserId: true,
} satisfies Prisma.WorkspaceLabelSelect;

export function workspaceLabelTopicId(
  label: Pick<
    WorkspaceLabel,
    "kind" | "archivedAt" | "createdByUserId" | "displayName" | "description"
  >,
) {
  if (
    label.kind === "TAG" &&
    label.archivedAt === null &&
    isUnmodifiedCuratedTag(label)
  ) {
    return TASK_TAG_IDS.find((id) => id === label.displayName.toLowerCase());
  }
}

export function toWorkspaceLabel(
  row: Prisma.WorkspaceLabelGetPayload<{ select: typeof workspaceLabelSelect }>,
) {
  const { createdByUserId: _, archivedAt, ...label } = row;
  return workspaceLabelSchema.parse({
    ...label,
    archived: archivedAt !== null,
    taskTopicId: workspaceLabelTopicId(row),
  });
}
