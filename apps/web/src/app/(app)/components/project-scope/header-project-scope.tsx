"use client";

import { ChevronRight, ChevronsUpDown, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { WORKSPACE_SWITCHER_ROW_CLASS } from "@/app/components/workspace-switcher/workspace-switcher-skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";
import { projectPageSection } from "./project-scope-href";
import {
  ProjectScopeBackdrop,
  ProjectScopeReason,
} from "./project-scope-required";
import {
  ScopeClosedBadge,
  useClearScope,
  useCurrentScope,
} from "./project-scope-trigger";
import {
  openScopeCreate,
  selectProjectScope,
  setScopeMenuOpen,
  useScopeMenuOpen,
  useScopeRequest,
} from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

/**
 * The project scope at the start of the top bar: the scope's mark and name
 * with an up/down chevron, opening the project menu. A
 * long name is shortened with "…"; the accessible name keeps it whole, as
 * "Project: …". A Closed project, which the menu never lists, gets a small
 * Closed badge. While a project is picked, an × beside it returns to All
 * projects. On a project's own pages the scope reads as a trail,
 * "Projects › Acme", whose first step opens the Projects list. Below md the
 * header's chip and bottom sheet take over.
 *
 * Its menu is the one every page opens when it needs a project
 * (`openProjectScope`). A required ask makes it modal over a dimmed page.
 */
export function HeaderProjectScope() {
  const t = useTranslations("App.ProjectScope");
  const open = useScopeMenuOpen();
  const request = useScopeRequest();
  const required = open && request?.required === true;
  const reasonId = useId();
  const { projectId, name, closed, label, mark, select } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const clearScope = useClearScope(triggerRef);
  const pathname = usePathname();
  const onProjectPage =
    projectId !== null && projectPageSection(pathname) !== null;

  return (
    <>
      {onProjectPage ? (
        <>
          <Link
            href="/projects"
            data-testid="project-scope-header-projects"
            className={cn(
              SIDEBAR_CONTROL_INTERACTION_CLASS,
              "text-muted-foreground hover:text-foreground press flex h-8 shrink-0 items-center rounded-full px-2 text-sm font-medium transition-[opacity,background-color,color]",
            )}
          >
            {t("all")}
          </Link>
          <ChevronRight
            className="text-muted-foreground -mx-1 size-3.5 shrink-0"
            aria-hidden
          />
        </>
      ) : null}
      {required ? <ProjectScopeBackdrop /> : null}
      <Popover open={open} onOpenChange={setScopeMenuOpen} modal={required}>
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
            {closed ? <ScopeClosedBadge /> : null}
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
          aria-describedby={request?.reason ? reasonId : undefined}
          data-required={required || undefined}
          // A required ask closes on Esc, not on a stray click on the page.
          onInteractOutside={(event) => {
            if (required) event.preventDefault();
          }}
          className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 motion-reduce:animate-none"
        >
          {request?.reason ? (
            <ProjectScopeReason id={reasonId} reason={request.reason} />
          ) : null}
          <ProjectScopeMenu
            selectedProjectId={projectId}
            onSelect={(id) => selectProjectScope(id, select)}
            onSelectAll={request ? undefined : () => select(null)}
            onCreate={openScopeCreate}
            onDone={() => setScopeMenuOpen(false)}
          />
        </PopoverContent>
      </Popover>
      {projectId !== null && (
        <button
          type="button"
          aria-label={t("clearProject")}
          title={t("clearProject")}
          onClick={clearScope}
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
