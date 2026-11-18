"use client";

import type { TaskTagSuggestion } from "@sokosumi/core-client";
import { useState } from "react";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import { useTaskTagCatalog } from "./task-tag-catalog";

export type DraftWorkspaceTagSuggestion = NonNullable<
  TaskTagSuggestion["workspaceSuggestions"]
>[number];

/** Only an edited selection is submitted. Unrelated edits keep tags another person added. */
export function useTaskFormWorkspaceTags(
  workspaceKey: string,
  initial: TaskWorkspaceTag[] = [],
  suggestions: DraftWorkspaceTagSuggestion[] = [],
) {
  const [draft, setDraft] = useState<{
    workspaceKey: string;
    base: TaskWorkspaceTag[];
    chosen: TaskWorkspaceTag[];
    chosenAt: number;
    dismissed: string[];
  } | null>(null);
  const [conflictScope, setConflictScope] = useState<string | null>(null);
  const catalog = useTaskTagCatalog();
  const current = draft?.workspaceKey === workspaceKey ? draft : null;
  const base = current?.base ?? initial;
  const initialIds = new Set(base.map((tag) => tag.id));
  const chosen =
    current && catalog && catalog.updatedAt >= current.chosenAt
      ? current.chosen.flatMap((tag) => {
          const label = catalog.byId.get(tag.id);
          if (!label || label.archived)
            return initialIds.has(tag.id) ? [tag] : [];
          return [
            { ...tag, displayName: label.displayName, color: label.color },
          ];
        })
      : (current?.chosen ?? initial);
  const dismissed = new Set(current?.dismissed);
  const chosenIds = new Set(chosen.map((tag) => tag.id));
  const remaining = suggestions.filter(
    (tag) => !dismissed.has(tag.id) && !chosenIds.has(tag.id),
  );
  const automatic = remaining
    .filter((tag) => tag.autoApply)
    .map(({ id, displayName, color }) => ({
      id,
      displayName,
      color,
      source: "jev" as const,
    }));
  const selected = [...chosen, ...automatic];
  const changed =
    chosen.length !== base.length || base.some((tag) => !chosenIds.has(tag.id));

  return {
    hasConflict: conflictScope === workspaceKey,
    reportConflict() {
      setDraft({
        workspaceKey,
        base,
        chosen: base,
        chosenAt: Date.now(),
        dismissed: [],
      });
      setConflictScope(workspaceKey);
    },
    reload(tags: TaskWorkspaceTag[]) {
      setDraft({
        workspaceKey,
        base: tags,
        chosen: tags,
        chosenAt: Date.now(),
        dismissed: [],
      });
      setConflictScope(null);
    },
    expectedWorkspaceTagIds: changed ? [...initialIds] : undefined,
    workspaceTags: selected,
    suggestions: remaining.filter((tag) => !tag.autoApply),
    workspaceTagIds: changed ? chosen.map((tag) => tag.id) : undefined,
    dismissedWorkspaceTagIds: dismissed.size ? [...dismissed] : undefined,
    setWorkspaceTags(next: TaskWorkspaceTag[]) {
      const kept = new Set(next.map((tag) => tag.id));
      const provisional = new Set(automatic.map((tag) => tag.id));
      for (const tag of selected) {
        if (
          !kept.has(tag.id) &&
          (tag.source === "jev" ||
            suggestions.some((item) => item.id === tag.id))
        )
          dismissed.add(tag.id);
      }
      for (const id of kept) dismissed.delete(id);
      setDraft({
        workspaceKey,
        base,
        chosen: next.filter((tag) => !provisional.has(tag.id)),
        chosenAt: Date.now(),
        dismissed: [...dismissed],
      });
    },
  };
}
