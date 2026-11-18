"use client";

import { useState } from "react";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";

/** Only an edited selection is submitted. Unrelated edits keep tags another person added. */
export function useTaskFormWorkspaceTags(
  workspaceKey: string,
  initial: TaskWorkspaceTag[] = [],
) {
  const [draft, setDraft] = useState<{
    workspaceKey: string;
    tags: TaskWorkspaceTag[];
  } | null>(null);
  const tags = draft?.workspaceKey === workspaceKey ? draft.tags : initial;
  const changed =
    tags.length !== initial.length ||
    tags.some((tag) => !initial.some((item) => item.id === tag.id));
  return {
    workspaceTags: tags,
    workspaceTagIds: changed ? tags.map((tag) => tag.id) : undefined,
    setWorkspaceTags(tags: TaskWorkspaceTag[]) {
      setDraft({ workspaceKey, tags });
    },
  };
}
