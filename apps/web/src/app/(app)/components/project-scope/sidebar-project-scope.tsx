"use client";

import { ChevronsUpDown } from "lucide-react";
import { SidebarGroup, useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import { useCurrentScope } from "./sidebar-project-scope-mobile";
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
 */
export function SidebarProjectScope() {
  const { setOpenMobile } = useSidebar();
  const sheetOpen = useScopeSheetOpen();
  const { name, label } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();

  return (
    <SidebarGroup className={SCOPE_TITLE_GROUP_CLASS}>
      {/* The mobile sidebar is a sheet. It closes and hands off to the
          header's bottom sheet, which outlives it. */}
      <button
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
        <ChevronsUpDown className={SCOPE_TITLE_ARROWS_CLASS} aria-hidden />
      </button>
    </SidebarGroup>
  );
}
