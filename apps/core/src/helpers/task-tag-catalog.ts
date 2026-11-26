import { createHash } from "node:crypto";
import type { TagColor } from "@sokosumi/database";
import { CURATED_FILE_VOCABULARY } from "@sokosumi/utils";
import type { TASK_TAG_IDS } from "@/helpers/task-tags";
import prisma, { type DbClient } from "@/lib/db/prisma";

export interface TaskWorkspaceTagCatalogEntry {
  id: string;
  displayName: string;
  description: string | null;
  color: TagColor | null;
  customColor?: string | null;
  vocabularyVersion: number;
  isUnmodifiedDefault?: boolean;
}

export type TaskWorkspaceTagSuggestion = Pick<
  TaskWorkspaceTagCatalogEntry,
  "id" | "displayName" | "color" | "customColor" | "vocabularyVersion"
> & { autoApply: boolean };

export interface TaskTagEvaluation {
  tags: (typeof TASK_TAG_IDS)[number][];
  workspaceSuggestions: TaskWorkspaceTagSuggestion[];
}

const curatedTagRubrics = new Map(
  CURATED_FILE_VOCABULARY.filter((label) => label.kind === "TAG").map(
    (label) => [label.displayName, label.description],
  ),
);

export function isUnmodifiedCuratedTag(label: {
  createdByUserId: string | null;
  displayName: string;
  description: string | null;
}) {
  return (
    label.createdByUserId === null &&
    curatedTagRubrics.get(label.displayName) === label.description
  );
}

export async function loadTaskTagCatalog(
  workspaceId: string,
  db: DbClient = prisma,
): Promise<TaskWorkspaceTagCatalogEntry[]> {
  const rows = await db.workspaceLabel.findMany({
    where: { workspaceId, kind: "TAG", archivedAt: null, mergedIntoId: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      displayName: true,
      description: true,
      color: true,
      customColor: true,
      vocabularyVersion: true,
      createdByUserId: true,
    },
  });
  return rows.map(({ createdByUserId, ...label }) => ({
    ...label,
    isUnmodifiedDefault: isUnmodifiedCuratedTag({ createdByUserId, ...label }),
  }));
}

/** Catalog order is stable by ID. Changes also invalidate a receipt when a writer omits a version bump. */
export function taskTagCatalogFingerprint(
  catalog: readonly TaskWorkspaceTagCatalogEntry[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        catalog.map(
          ({
            id,
            displayName,
            description,
            isUnmodifiedDefault,
            vocabularyVersion,
          }) => [
            id,
            displayName,
            description,
            Boolean(isUnmodifiedDefault),
            vocabularyVersion,
          ],
        ),
      ),
    )
    .digest("base64url");
}

export function workspaceTagSuggestion(
  {
    id,
    displayName,
    color,
    customColor,
    vocabularyVersion,
  }: TaskWorkspaceTagCatalogEntry,
  autoApply: boolean,
): TaskWorkspaceTagSuggestion {
  return { id, displayName, color, customColor, vocabularyVersion, autoApply };
}
