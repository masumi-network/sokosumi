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
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import { useCurrentScope } from "./sidebar-project-scope-mobile";
import {
  openScopeCreate,
  openScopeSheet,
  useScopeSheetOpen,
} from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

/** The row grows past the one-line height, so its hover covers both lines. */
const SCOPE_ROW_CLASS =
  "h-auto min-h-11 py-1 font-medium data-[state=open]:bg-sidebar-accent md:h-auto md:min-h-8";

/**
 * The project scope row above the navigation links it scopes. Two lines,
 * "Project" over its value, so a long project name is not cut short by the
 * label.
 */
export function SidebarProjectScope() {
  const t = useTranslations("App.ProjectScope");
  const { isMobile, setOpenMobile } = useSidebar();
  const sheetOpen = useScopeSheetOpen();
  const [open, setOpen] = useState(false);
  const { projectId, name, mark, select } = useCurrentScope();
  const prefetch = usePrefetchScopeProjects();

  const value = projectId === null ? t("allProjects") : name;
  const label = `${t("label")}: ${value}`;

  const content = (
    <>
      <SidebarRowSlot aria-hidden>{mark}</SidebarRowSlot>
      <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "flex flex-col")}>
        <span className="text-muted-foreground truncate text-xs leading-4 font-normal">
          {t("label")}
        </span>
        <span className="truncate leading-5">{value}</span>
      </span>
      <ChevronsUpDown
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </>
  );

  return (
    <SidebarGroup className="w-full px-2 py-0">
      <SidebarMenu className="py-2">
        <SidebarMenuItem>
          {isMobile ? (
            // The mobile sidebar is a sheet. It closes and hands off to the
            // header's bottom sheet, which outlives it.
            <SidebarMenuButton
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              aria-label={label}
              data-testid="project-scope-sidebar-row"
              className={SCOPE_ROW_CLASS}
              onPointerDown={prefetch}
              onClick={() => {
                setOpenMobile(false);
                openScopeSheet();
              }}
            >
              {content}
            </SidebarMenuButton>
          ) : (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <SidebarMenuButton
                  type="button"
                  aria-label={label}
                  data-testid="project-scope-sidebar-row"
                  className={SCOPE_ROW_CLASS}
                  onPointerEnter={prefetch}
                  onFocus={prefetch}
                >
                  {content}
                </SidebarMenuButton>
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
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
