"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SidebarGroup, useSidebar } from "@/components/ui/sidebar";

import { useCurrentScope } from "./sidebar-project-scope-mobile";
import {
  openScopeCreate,
  openScopeSheet,
  useScopeSheetOpen,
} from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

/**
 * Not a Sidebar row: no leading mark, so the name starts where a section
 * heading's title does. 44px on the phone sheet, for a thumb.
 */
const SCOPE_TITLE_CLASS =
  "press text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent flex h-11 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-sm font-semibold outline-hidden transition-colors focus-visible:ring-2 md:h-8";

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
      <ChevronDown
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
    </>
  );

  return (
    <SidebarGroup className="w-full px-2 pt-2 pb-0">
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
