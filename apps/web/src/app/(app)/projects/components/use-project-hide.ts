"use client";

import { QueryClientContext } from "@tanstack/react-query";
import { useContext, useTransition } from "react";
import { toast } from "sonner";
import { SCOPE_PAGE_QUERY_KEY } from "@/app/components/project-scope/use-scope-projects";
import {
  hideProjectAction,
  pinProjectAction,
  showProjectAction,
} from "@/app/projects/actions";
import { PINNED_PROJECTS_QUERY_KEY } from "@/hooks/use-pinned-projects";

export interface ProjectHideLabels {
  hide: string;
  show: string;
  /** Toast after a Hide, beside its Undo. */
  hidden: string;
  undo: string;
  hideError: string;
  showError: string;
}

/**
 * Hide and Show for the project card menu and the project header menu. A
 * Hide unpins (ADR 0036), so its Undo shows the project and Pins it again
 * when Core says the Hide removed a Pin.
 */
export function useProjectHide({
  labels,
  onChange,
}: {
  labels: ProjectHideLabels;
  /** Runs once a Hide, Show or Undo has landed, e.g. to refetch the page. */
  onChange?: () => void;
}) {
  // Best-effort, as in `ProjectPinButton`: these stay renderable without a
  // query provider.
  const queryClient = useContext(QueryClientContext);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    // The Pin list and the switcher's list both drop a Hidden project.
    await Promise.all([
      queryClient?.invalidateQueries({ queryKey: [PINNED_PROJECTS_QUERY_KEY] }),
      queryClient?.invalidateQueries({ queryKey: [SCOPE_PAGE_QUERY_KEY] }),
    ]);
    onChange?.();
  }

  async function undoHide(projectId: string, unpinned: boolean) {
    try {
      await showProjectAction({ projectId });
      // shortcut: the Pin comes back last among the reader's Pins, not in its
      // old place; restore starredAt in Core if that order ever matters.
      if (unpinned) await pinProjectAction({ projectId });
    } catch {
      toast.error(labels.showError);
    }
    await refresh();
  }

  function hide(projectId: string) {
    startTransition(async () => {
      let unpinned: boolean;
      try {
        ({ unpinned } = await hideProjectAction({ projectId }));
      } catch {
        toast.error(labels.hideError);
        return;
      }
      await refresh();
      toast.success(labels.hidden, {
        action: {
          label: labels.undo,
          onClick: () => void undoHide(projectId, unpinned),
        },
      });
    });
  }

  function show(projectId: string) {
    startTransition(async () => {
      try {
        await showProjectAction({ projectId });
      } catch {
        toast.error(labels.showError);
        return;
      }
      await refresh();
    });
  }

  return { hide, show, isPending };
}
