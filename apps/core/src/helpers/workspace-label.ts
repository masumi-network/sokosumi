import type { Prisma } from "@sokosumi/database";
import { isUnmodifiedCuratedTag } from "@/helpers/task-tag-catalog";
import { TASK_TAG_IDS } from "@/helpers/task-tags";
import { workspaceLabelSchema } from "@/schemas/file-resource.schema";

export const workspaceLabelSelect = {
  id: true,
  kind: true,
  displayName: true,
  description: true,
  color: true,
  archivedAt: true,
  vocabularyVersion: true,
  createdByUserId: true,
} satisfies Prisma.WorkspaceLabelSelect;

export function toWorkspaceLabel({
  createdByUserId,
  archivedAt,
  ...label
}: Prisma.WorkspaceLabelGetPayload<{ select: typeof workspaceLabelSelect }>) {
  const isTopicAlias =
    label.kind === "TAG" &&
    archivedAt === null &&
    isUnmodifiedCuratedTag({ createdByUserId, ...label });
  return workspaceLabelSchema.parse({
    ...label,
    archived: archivedAt !== null,
    taskTopicId: isTopicAlias
      ? TASK_TAG_IDS.find((id) => id === label.displayName.toLowerCase())
      : undefined,
  });
}
