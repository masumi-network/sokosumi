"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCreateWorkspace } from "@/app/components/header/use-create-workspace";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { ScopeSlots } from "./scope-variants";
import {
  SwitchingPane,
  useCombinedScope,
  useCombinedWorkspaces,
  WorkspaceList,
  type WorkspaceSwitcher,
} from "./variant-combined-parts";
import { CombinedMobileChip } from "./variant-combined-sheet";
import { useWorkspaceName } from "./variant-header-workspace";

type CombinedScope = ReturnType<typeof useCombinedScope>;

/** Rendered only while the popover is open, so it reads workspaces then. */
function CombinedPanes({
  scope,
  switcher,
  onDone,
  onCreateWorkspace,
}: {
  scope: CombinedScope;
  switcher: WorkspaceSwitcher;
  onDone: () => void;
  onCreateWorkspace: (canCreatePersonal: boolean) => void;
}) {
  const workspaces = useCombinedWorkspaces(switcher);
  return (
    <>
      <WorkspaceList
        workspaces={workspaces}
        onCreateWorkspace={onCreateWorkspace}
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
  switcher,
  onDone,
  onCreateWorkspace,
}: {
  scope: CombinedScope;
  switcher: WorkspaceSwitcher;
  onDone: () => void;
  onCreateWorkspace: (canCreatePersonal: boolean) => void;
}) {
  const t = useTranslations("App.ProjectScope");

  return (
    <PopoverContent
      align="end"
      aria-label={t("switchLabel")}
      className="grid w-[36rem] max-w-[calc(100vw-2rem)] grid-cols-[13rem_1fr] overflow-hidden p-0"
    >
      <CombinedPanes
        scope={scope}
        switcher={switcher}
        onDone={onDone}
        onCreateWorkspace={onCreateWorkspace}
      />
    </PopoverContent>
  );
}

/**
 * The header's workspace control from md up, as `Workspace / Project`: one
 * control for both. Below md the chip opens the sheet, and the header keeps
 * today's workspace switch.
 */
function HeaderTrigger() {
  const t = useTranslations("App.ProjectScope");
  const scope = useCombinedScope();
  const workspaceName = useWorkspaceName();
  // Here, not in the content: a switch and its dialogs outlive the popover.
  const switcher = useWorkspaceSwitcher();
  const createWorkspace = useCreateWorkspace(switcher.handleSelectWorkspace);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex min-w-0 max-md:hidden">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-busy={switcher.isPending || undefined}
              data-testid="project-scope-combined-header-trigger"
              className={cn(
                "max-w-80 min-w-0 justify-start gap-1.5 overflow-hidden px-2 font-medium has-[>svg]:px-2",
                switcher.isPending && "animate-pulse",
              )}
            >
              <span className="sr-only">
                {t("switchLabel")}{" "}
                {[workspaceName, scope.name].filter(Boolean).join(" / ")}
              </span>
              <span aria-hidden className="flex min-w-0 items-center gap-1.5">
                {workspaceName ? (
                  <span className="text-muted-foreground max-w-32 min-w-0 truncate">
                    {workspaceName}
                  </span>
                ) : (
                  <Skeleton className="h-3 w-16 shrink-0" />
                )}
                <span className="text-muted-foreground shrink-0">/</span>
                {scope.mark}
                <span className="min-w-0 truncate">{scope.name}</span>
              </span>
              <ChevronsUpDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            </Button>
          </PopoverTrigger>
          <CombinedPopoverContent
            scope={scope}
            switcher={switcher}
            onDone={() => setOpen(false)}
            onCreateWorkspace={(canCreatePersonal) => {
              setOpen(false);
              createWorkspace.start(canCreatePersonal);
            }}
          />
        </Popover>
      </div>
      {scope.createDialog}
      {createWorkspace.dialogs}
    </>
  );
}

/** SOK-1202 variant "combined": Vercel's two-pane workspace/project switcher. */
export const combinedSlots: ScopeSlots = {
  "header-workspace": HeaderTrigger,
  "header-mobile": CombinedMobileChip,
};
