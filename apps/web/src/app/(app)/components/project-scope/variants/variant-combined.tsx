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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { ScopeSlots } from "./scope-variants";
import {
  SwitchingPane,
  useCombinedScope,
  useCombinedWorkspaces,
  WorkspaceList,
} from "./variant-combined-parts";
import {
  CombinedMobileChip,
  setCombinedSheetOpen,
  useCombinedSheetOpen,
} from "./variant-combined-sheet";

type CombinedScope = ReturnType<typeof useCombinedScope>;

/** Rendered only while the popover is open, so it reads workspaces then. */
function CombinedPanes({
  scope,
  onDone,
}: {
  scope: CombinedScope;
  onDone: () => void;
}) {
  const workspaces = useCombinedWorkspaces();
  return (
    <>
      <WorkspaceList
        workspaces={workspaces}
        className="bg-sidebar max-h-[22rem] overflow-y-auto border-r"
      />
      <SwitchingPane isSwitching={workspaces.isSwitching} className="min-w-0">
        <ProjectScopeMenu
          selectedProjectId={scope.projectId}
          onSelect={scope.select}
          onCreate={scope.openCreate}
          onDone={onDone}
          className="rounded-none"
        />
      </SwitchingPane>
    </>
  );
}

/** Vercel's two panes: workspaces on the left, that workspace's projects. */
function CombinedPopoverContent({
  scope,
  side,
  onDone,
}: {
  scope: CombinedScope;
  side: "bottom" | "right";
  onDone: () => void;
}) {
  const t = useTranslations("App.ProjectScope");

  return (
    <PopoverContent
      side={side}
      align="start"
      sideOffset={side === "right" ? 8 : 4}
      aria-label={t("switchLabel")}
      className="grid w-[36rem] max-w-[calc(100vw-2rem)] grid-cols-[13rem_1fr] overflow-hidden p-0"
    >
      <CombinedPanes scope={scope} onDone={onDone} />
    </PopoverContent>
  );
}

/**
 * Beside the logo. The header row leaves it about 28px on desktop, so a
 * container query shows the name only where the row has room: the mobile
 * sidebar sheet. There it hands off to the header's bottom sheet.
 */
function SidebarHeaderTrigger() {
  const t = useTranslations("App.ProjectScope");
  const { isMobile, setOpenMobile } = useSidebar();
  const scope = useCombinedScope();
  const sheetOpen = useCombinedSheetOpen();
  const [open, setOpen] = useState(false);

  const className =
    "@container ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-sm font-medium outline-hidden focus-visible:ring-2 group-data-[collapsible=icon]:hidden";
  const face = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center">
        {scope.mark}
      </span>
      <span className="sr-only">
        {t("switchLabel")} {scope.name}
      </span>
      <span
        aria-hidden
        className="hidden min-w-0 flex-1 truncate text-left @[5rem]:block"
      >
        {scope.name}
      </span>
      <ChevronsUpDown
        className="text-muted-foreground hidden size-3.5 shrink-0 @[5rem]:block"
        aria-hidden
      />
    </>
  );

  if (isMobile) {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        data-testid="project-scope-combined-sidebar-trigger"
        className={className}
        onClick={() => {
          setOpenMobile(false);
          setCombinedSheetOpen(true);
        }}
      >
        {face}
      </button>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="project-scope-combined-sidebar-trigger"
                className={className}
              >
                {face}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" hidden={open}>
            {scope.name}
          </TooltipContent>
        </Tooltip>
        <CombinedPopoverContent
          scope={scope}
          side="bottom"
          onDone={() => setOpen(false)}
        />
      </Popover>
      {scope.createDialog}
    </>
  );
}

/** The collapsed rail has no room in the header, so the trigger moves here. */
function RailTrigger() {
  const t = useTranslations("App.ProjectScope");
  const { isMobile } = useSidebar();
  const scope = useCombinedScope();
  const [open, setOpen] = useState(false);

  // Below `md` the sidebar is a sheet and never the rail.
  if (isMobile) return null;

  return (
    <SidebarGroup className="hidden w-full px-2 py-0 group-data-[collapsible=icon]:flex">
      <SidebarMenu className="gap-0 pt-2">
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <SidebarMenuButton
                    type="button"
                    data-testid="project-scope-combined-rail-trigger"
                  >
                    <SidebarRowSlot>{scope.mark}</SidebarRowSlot>
                    <span className="sr-only">
                      {t("switchLabel")} {scope.name}
                    </span>
                  </SidebarMenuButton>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" hidden={open}>
                {scope.name}
              </TooltipContent>
            </Tooltip>
            <CombinedPopoverContent
              scope={scope}
              side="right"
              onDone={() => setOpen(false)}
            />
          </Popover>
          {scope.createDialog}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** SOK-1202 variant "combined": Vercel's two-pane workspace/project switcher. */
export const combinedSlots: ScopeSlots = {
  "sidebar-header": SidebarHeaderTrigger,
  "sidebar-top": RailTrigger,
  "header-mobile": CombinedMobileChip,
};
