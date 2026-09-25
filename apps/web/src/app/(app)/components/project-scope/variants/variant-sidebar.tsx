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
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

import type { ScopeSlots } from "./scope-variants";
import {
  openScopeCreate,
  openScopeSheet,
  SidebarScopeMobileChip,
  useCurrentScope,
  useScopeSheetOpen,
} from "./variant-sidebar-mobile";

/**
 * SOK-1202 variant "sidebar": the Vercel pattern. One scope row at the top of
 * the sidebar, above the nav it scopes.
 */
function SidebarScopeRow() {
  const t = useTranslations("App.ProjectScope");
  const { isMobile, state, setOpenMobile } = useSidebar();
  const sheetOpen = useScopeSheetOpen();
  const [open, setOpen] = useState(false);
  const { projectId, name, label, mark, select } = useCurrentScope();
  const collapsed = state === "collapsed" && !isMobile;

  const content = (
    <>
      <SidebarRowSlot aria-hidden>{mark}</SidebarRowSlot>
      <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "truncate")}>{name}</span>
      <ChevronsUpDown
        className="text-muted-foreground size-4 shrink-0 group-data-[collapsible=icon]:hidden"
        aria-hidden
      />
    </>
  );

  return (
    <>
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
                className="font-medium"
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
                    className="font-medium"
                    // Rail only, and not over its own open popover.
                    tooltip={{ children: label, hidden: !collapsed || open }}
                  >
                    {content}
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent
                  side={collapsed ? "right" : "bottom"}
                  align="start"
                  sideOffset={collapsed ? 8 : 4}
                  aria-label={t("switchLabel")}
                  className="w-72 p-0"
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
      <SidebarSeparator />
    </>
  );
}

export const sidebarSlots: ScopeSlots = {
  "sidebar-top": SidebarScopeRow,
  "header-mobile": SidebarScopeMobileChip,
};
