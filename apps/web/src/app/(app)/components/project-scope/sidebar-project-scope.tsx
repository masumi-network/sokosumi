"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SidebarGroup, useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_CONTROL_INTERACTION_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import { useCurrentScope } from "./sidebar-project-scope-mobile";
import {
  SCOPE_TITLE_CHEVRON_CLASS,
  SCOPE_TITLE_GROUP_CLASS,
  SCOPE_TITLE_ROW_CLASS,
} from "./sidebar-project-scope-shape";
import {
  openScopeCreate,
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
 * The project scope as the title the nav sits under: the scope's name and a
 * chevron, where the nav groups below it are what it scopes. A long name is
 * shortened with "…"; the accessible name keeps it whole, as "Project: …".
 */
export function SidebarProjectScope() {
  const t = useTranslations("App.ProjectScope");
  const { isMobile, setOpenMobile } = useSidebar();
  const sheetOpen = useScopeSheetOpen();
  const [open, setOpen] = useState(false);
  const { projectId, name, label, select } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();

  const content = (
    <>
      <span className="min-w-0 truncate">{name}</span>
      <ChevronsUpDown className={SCOPE_TITLE_CHEVRON_CLASS} aria-hidden />
    </>
  );

  return (
    <SidebarGroup className={SCOPE_TITLE_GROUP_CLASS}>
      {isMobile ? (
        // The mobile sidebar is a sheet. It closes and hands off to the
        // header's bottom sheet, which outlives it.
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
          {content}
        </button>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              data-testid="project-scope-sidebar-title"
              className={SCOPE_TITLE_CLASS}
              onPointerEnter={prefetch}
              onFocus={prefetch}
            >
              {content}
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
      )}
    </SidebarGroup>
  );
}
