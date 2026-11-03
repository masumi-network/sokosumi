"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { SidebarGroup, useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import {
  ScopeClosedBadge,
  useClearScope,
  useCurrentScope,
} from "./project-scope-trigger";
import {
  SCOPE_TITLE_ARROWS_CLASS,
  SCOPE_TITLE_GROUP_CLASS,
  SCOPE_TITLE_ROW_CLASS,
} from "./sidebar-project-scope-shape";
import {
  openScopeSheet,
  useScopeSheetOpen,
} from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

const SCOPE_TITLE_CLASS = cn(
  SCOPE_TITLE_ROW_CLASS,
  SIDEBAR_CONTROL_INTERACTION_CLASS,
  "press text-sidebar-foreground transition-colors",
);

/**
 * The project scope as the title the phone sheet's nav sits under: the scope's
 * name and chevrons, which hand off to the header's bottom sheet. From md the
 * header's selector is the scope's control and this is hidden. A long name is
 * shortened with "…"; the accessible name keeps it whole, as "Project: …".
 * While a project is picked, an × beside it returns to All projects: in a chat
 * room the header's chip, and its ×, give way to the room's toolbar.
 */
export function SidebarProjectScope() {
  const { setOpenMobile } = useSidebar();
  const sheetOpen = useScopeSheetOpen();
  const t = useTranslations("App.ProjectScope");
  const { projectId, name, closed, label } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();
  const titleRef = useRef<HTMLButtonElement>(null);
  const clearScope = useClearScope(titleRef);

  return (
    <SidebarGroup
      className={cn(SCOPE_TITLE_GROUP_CLASS, "flex-row items-center gap-1")}
    >
      {/* The mobile sidebar is a sheet. It closes and hands off to the
          header's bottom sheet, which outlives it. */}
      <button
        ref={titleRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label={label}
        data-testid="project-scope-sidebar-title"
        className={SCOPE_TITLE_CLASS}
        onPointerDown={prefetch}
        onClick={() => {
          setOpenMobile(false);
          openScopeSheet();
        }}
      >
        <span className="min-w-0 truncate">{name}</span>
        {closed ? <ScopeClosedBadge /> : null}
        <ChevronsUpDown className={SCOPE_TITLE_ARROWS_CLASS} aria-hidden />
      </button>
      {projectId !== null && (
        <button
          type="button"
          aria-label={t("clearProject")}
          title={t("clearProject")}
          data-testid="project-scope-title-clear"
          onClick={clearScope}
          className={cn(
            SIDEBAR_CONTROL_INTERACTION_CLASS,
            "text-muted-foreground hover:text-foreground press hit-area flex size-11 shrink-0 items-center justify-center rounded-md transition-colors",
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </SidebarGroup>
  );
}
