"use client";

import type {
  TaskTagId,
  TaskTagSuggestion,
  TaskTags,
} from "@sokosumi/core-client";
import { useState } from "react";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import type { TaskFormProps } from "./task-form-types";
import {
  representedTaskTopics,
  useTaskTagCatalog,
  useVisibleTaskTopicIds,
} from "./task-tag-catalog";

/** Only an edited selection is submitted. Unrelated edits keep tags another person added. */
export function useTaskFormWorkspaceTags(
  workspaceKey: string,
  initial?: TaskFormProps["initialValues"],
  draftTags?: Pick<TaskTagSuggestion, "tags" | "workspaceSuggestions">,
) {
  const suggestions = draftTags?.workspaceSuggestions ?? [];
  const [topicEdits, setTopicEdits] = useState<{
    workspaceKey: string;
    dismissed: TaskTagId[];
    refreshed?: TaskTags;
  } | null>(null);
  const topicState =
    topicEdits?.workspaceKey === workspaceKey ? topicEdits : null;
  const inheritedTopics = topicState?.refreshed ?? initial?.tags;
  const activeTopics = new Set([
    ...(inheritedTopics?.manual ?? []),
    ...(inheritedTopics?.automatic ?? []),
    ...(draftTags?.tags ?? []),
  ]);
  function updateTopics({
    dismiss = [],
    restore,
  }: {
    dismiss?: TaskTagId[];
    restore?: Set<TaskTagId>;
  }) {
    setTopicEdits((previous) => {
      const current = previous?.workspaceKey === workspaceKey ? previous : null;
      const omitted = new Set([...(current?.dismissed ?? []), ...dismiss]);
      for (const id of restore ?? []) omitted.delete(id);
      return {
        workspaceKey,
        refreshed: current?.refreshed,
        dismissed: [...omitted],
      };
    });
  }
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
  const initialTags = current?.base ?? initial?.workspaceTags ?? [];
  const base =
    initial?.copyOfTaskId && catalog?.vocabularyKey
      ? initialTags.filter((tag) => {
          const label = catalog.byId.get(tag.id);
          return label && !label.archived;
        })
      : initialTags;
  const initialIds = new Set(base.map((tag) => tag.id));
  const refreshedCatalog =
    current && catalog && catalog.updatedAt >= current.chosenAt
      ? catalog
      : null;
  const chosen =
    current && refreshedCatalog
      ? current.chosen.flatMap((tag) => {
          const label = refreshedCatalog.byId.get(tag.id);
          if (!label || label.archived)
            return initialIds.has(tag.id) ? [tag] : [];
          return [
            { ...tag, displayName: label.displayName, color: label.color },
          ];
        })
      : (current?.chosen ?? base);
  const dismissed = new Set(current?.dismissed);
  if (refreshedCatalog && (draftTags || initial?.copyOfTaskId)) {
    for (const id of dismissed) {
      const label = refreshedCatalog.byId.get(id);
      if (!label || label.archived) dismissed.delete(id);
    }
  }
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
  const visibleTopics = useVisibleTaskTopicIds(
    [...activeTopics].filter((id) => !topicState?.dismissed.includes(id)),
    selected,
  );
  const changed =
    chosen.length !== base.length || base.some((tag) => !chosenIds.has(tag.id));

  function discardTagEdits(
    workspaceTags: TaskWorkspaceTag[],
    topics?: TaskTags,
  ) {
    setTopicEdits({ workspaceKey, refreshed: topics, dismissed: [] });
    setDraft({
      workspaceKey,
      base: workspaceTags,
      chosen: workspaceTags,
      chosenAt: Date.now(),
      dismissed: [],
    });
  }

  return {
    hasConflict: conflictScope === workspaceKey,
    reportConflict() {
      discardTagEdits(base, inheritedTopics);
      setConflictScope(workspaceKey);
    },
    reload(tags: TaskWorkspaceTag[], topics: TaskTags) {
      discardTagEdits(tags, topics);
      setConflictScope(null);
    },
    visibleTopics,
    removeTopic(id: TaskTagId) {
      updateTopics({ dismiss: [id] });
    },
    dismissedTopicIds: topicState?.dismissed.length
      ? topicState.dismissed
      : undefined,
    expectedWorkspaceTagIds: changed ? [...initialIds] : undefined,
    workspaceTags: selected,
    liveAutomaticIds: new Set(automatic.map((tag) => tag.id)),
    suggestions: remaining.filter((tag) => !tag.autoApply),
    workspaceTagIds: changed ? chosen.map((tag) => tag.id) : undefined,
    dismissedWorkspaceTagIds: dismissed.size ? [...dismissed] : undefined,
    setWorkspaceTags(next: TaskWorkspaceTag[]) {
      const kept = new Set(next.map((tag) => tag.id));
      const provisional = new Set(automatic.map((tag) => tag.id));
      const removed = selected.filter((tag) => !kept.has(tag.id));
      const removedTopics = [...representedTaskTopics(catalog, removed)].filter(
        (id) => draftTags || activeTopics.has(id),
      );
      const added = next.filter(
        (tag) => !chosenIds.has(tag.id) && !provisional.has(tag.id),
      );
      const restoredTopics = representedTaskTopics(catalog, added);
      if (removedTopics.length || restoredTopics.size)
        updateTopics({ dismiss: removedTopics, restore: restoredTopics });
      for (const tag of removed) {
        if (draftTags || tag.source === "jev") dismissed.add(tag.id);
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
