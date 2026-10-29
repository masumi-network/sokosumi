"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
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
 * "Project: …". While a project is picked, an × beside it returns to All
 * projects. Below md the header's chip and bottom sheet take over.
 */
export function HeaderProjectScope() {
  const t = useTranslations("App.ProjectScope");
  const [open, setOpen] = useState(false);
  const { projectId, name, label, mark, select } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
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
      {projectId !== null && (
        <button
          type="button"
          aria-label={t("clearProject")}
          title={t("clearProject")}
          onClick={() => {
            select(null);
            // This button unmounts with the scope; keep focus in the header.
            triggerRef.current?.focus();
          }}
          className={cn(
            SIDEBAR_CONTROL_INTERACTION_CLASS,
            "text-muted-foreground hover:text-foreground press hit-area flex size-8 shrink-0 items-center justify-center rounded-full transition-[opacity,background-color,color]",
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </>
  );
}
