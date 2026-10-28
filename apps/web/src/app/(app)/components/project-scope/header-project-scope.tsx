"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { WORKSPACE_SWITCHER_ROW_CLASS } from "@/app/components/workspace-switcher/workspace-switcher-skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import { useCurrentScope } from "./sidebar-project-scope-mobile";
import { openScopeCreate } from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

/**
 * The project scope at the start of the top bar: the scope's mark and name
 * with an up/down chevron, opening the project menu. A
 * long name is shortened with "…"; the accessible name keeps it whole, as
 * "Project: …". Below md the header's chip and bottom sheet take over.
 */
export function HeaderProjectScope() {
  const t = useTranslations("App.ProjectScope");
  const [open, setOpen] = useState(false);
  const { projectId, name, label, mark, select } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={name}
          data-testid="project-scope-header-trigger"
          onPointerEnter={prefetch}
          onFocus={prefetch}
          className={cn(
            // The Workspace switcher's own row and pill, so the two pickers
            // share type, height and fill.
            WORKSPACE_SWITCHER_ROW_CLASS,
            SIDEBAR_CONTROL_INTERACTION_CLASS,
            "text-foreground press shrink rounded-full font-medium transition-[opacity,background-color]",
          )}
        >
          {/* The mark's glyph names no size, so this box gives it one. */}
          <span aria-hidden className="flex shrink-0 [&>svg]:size-5">
            {mark}
          </span>
          <span className="min-w-0 truncate">{name}</span>
          <ChevronsUpDown
            className="text-muted-foreground size-3 shrink-0"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        aria-label={t("switchLabel")}
        className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 motion-reduce:animate-none"
      >
        <ProjectScopeMenu
          selectedProjectId={projectId}
          onSelect={select}
          onCreate={openScopeCreate}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
