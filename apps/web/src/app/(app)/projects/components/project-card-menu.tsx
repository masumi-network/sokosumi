"use client";

import { Eye, EyeOff, MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { type ProjectHideLabels, useProjectHide } from "./use-project-hide";

interface ProjectCardMenuProps {
  projectId: string;
  /** The card sits in the Hidden view, so it offers Show instead of Hide. */
  hidden: boolean;
  labels: ProjectHideLabels & { moreActions: string };
  onHiddenChange?: () => void;
}

/**
 * A project card's menu. Hide lives here rather than as its own button: it
 * is rare, and a second always-there icon would crowd the Pin.
 */
export function ProjectCardMenu({
  projectId,
  hidden,
  labels,
  onHiddenChange,
}: ProjectCardMenuProps) {
  const { hide, show, isPending } = useProjectHide({
    labels,
    onChange: onHiddenChange,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          aria-label={labels.moreActions}
          title={labels.moreActions}
          data-testid="project-card-menu"
          className={cn(
            "focus-visible:ring-ring text-muted-foreground hover:text-foreground relative inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-[color,opacity] outline-hidden focus-visible:ring-2",
            // Same 44px hit area as the Pin beside it.
            "before:absolute before:-inset-1.5 before:content-['']",
            "disabled:pointer-events-none disabled:opacity-50",
            // Revealed like an unpinned Pin; touch keeps it visible.
            "pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hidden ? (
          <DropdownMenuItem onSelect={() => show(projectId)}>
            <Eye className="size-4" aria-hidden />
            {labels.show}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => hide(projectId)}>
            <EyeOff className="size-4" aria-hidden />
            {labels.hide}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
