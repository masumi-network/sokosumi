"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { returnFocusTo } from "@/app/components/project-scope/use-project-scope";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  SwitchingPane,
  useCombinedScope,
  useCombinedWorkspaces,
  WorkspaceList,
  WorkspaceMark,
  type WorkspaceSwitcher,
} from "./variant-combined-parts";

/**
 * The bottom sheet's open state, shared by the chip and the sheet's content,
 * which closes the sheet after a pick.
 */
let sheetOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setCombinedSheetOpen(next: boolean) {
  sheetOpen = next;
  for (const listener of listeners) listener();
}

export function useCombinedSheetOpen() {
  return useSyncExternalStore(
    subscribe,
    () => sheetOpen,
    () => false,
  );
}

/**
 * Below `md`: a chip with the current scope. It opens a bottom sheet with the
 * project list, and one row there swaps in the workspace list. Create project
 * finds the chip through its `aria-controls`.
 */
export function CombinedMobileChip() {
  const t = useTranslations("App.ProjectScope");
  const pathname = usePathname();
  const open = useCombinedSheetOpen();
  const scope = useCombinedScope();
  // Here, not in the body: the switch outlives a close of the sheet.
  const switcher = useWorkspaceSwitcher();
  const chipRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Sheet open={open} onOpenChange={setCombinedSheetOpen}>
        <SheetTrigger asChild>
          <Button
            ref={chipRef}
            type="button"
            variant="outline"
            size="sm"
            data-testid="project-scope-combined-chip"
            className={cn(
              "min-w-0 max-w-40 shrink justify-start gap-1.5 px-2 font-medium md:hidden",
              // A chat room's toolbar takes this row on phones.
              pathname && isChatRoomPathname(pathname) && "hidden",
            )}
          >
            {scope.mark}
            <span className="sr-only">{t("switchLabel")}</span>
            <span className="min-w-0 flex-1 truncate">{scope.name}</span>
            <ChevronDown
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          // Radix returns focus to the chip, which a chat room hides.
          onCloseAutoFocus={(event) => returnFocusTo(chipRef.current)(event)}
          className="max-h-[85dvh] gap-0 rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{t("switchLabel")}</SheetTitle>
          </SheetHeader>
          <CombinedSheetBody scope={scope} switcher={switcher} />
        </SheetContent>
      </Sheet>
      {scope.createDialog}
    </>
  );
}

/** The control each step would autofocus, had it not mounted mid-switch. */
const STEP_FOCUS_SELECTOR = {
  projects: '[data-slot="command-input"]',
  workspaces: "button",
} as const;

/**
 * Mounted only while the sheet is open: it reads workspaces on each open, and
 * its step starts at the project list every time.
 */
function CombinedSheetBody({
  scope,
  switcher,
}: {
  scope: ReturnType<typeof useCombinedScope>;
  switcher: WorkspaceSwitcher;
}) {
  const tWorkspace = useTranslations("Components.OrganizationSwitcher");
  const tSidebar = useTranslations("App.Sidebar.Content.MenuItems");
  const workspaces = useCombinedWorkspaces(switcher);
  const [step, setStep] = useState<"projects" | "workspaces">("projects");
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasSwitching = useRef(workspaces.isSwitching);

  // A step that mounts mid-switch cannot autofocus: the project pane is inert
  // and Back is disabled, so Radix parks focus on the sheet. Once the switch
  // ends, focus the step's control, unless the user has moved focus since.
  useEffect(() => {
    const ended = wasSwitching.current && !workspaces.isSwitching;
    wasSwitching.current = workspaces.isSwitching;
    const body = bodyRef.current;
    if (!ended || !body) return;
    const focused = document.activeElement;
    const parked =
      focused == null ||
      focused === document.body ||
      focused === body.closest('[role="dialog"]');
    if (!parked) return;
    body.querySelector<HTMLElement>(STEP_FOCUS_SELECTOR[step])?.focus();
  }, [workspaces.isSwitching, step]);

  // Settled with no active workspace, as when the list failed to load.
  const workspaceName =
    workspaces.active?.name ??
    (workspaces.isPending ? null : tWorkspace("switchWorkspace"));

  if (step === "projects") {
    return (
      // `contents` keeps the sheet's flex layout; the ref scopes the focus query.
      <div ref={bodyRef} className="contents">
        <button
          type="button"
          data-testid="project-scope-combined-workspace-row"
          onClick={() => setStep("workspaces")}
          className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-12 w-full shrink-0 items-center gap-2 border-b px-4 text-left text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-inset"
        >
          <WorkspaceMark
            workspaces={workspaces}
            workspace={workspaces.active}
          />
          {/* The fallback repeats the sr-only name below, so hide it once. */}
          <span
            aria-hidden={workspaces.active ? undefined : true}
            className="min-w-0 flex-1 truncate"
          >
            {workspaceName}
          </span>
          {/* Names the row in every state, pending included. */}
          <span className="sr-only">{tWorkspace("switchWorkspace")}</span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        </button>
        <SwitchingPane
          isSwitching={workspaces.isSwitching}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ProjectScopeMenu
            selectedProjectId={scope.projectId}
            onSelect={scope.select}
            onCreate={scope.openCreate}
            onDone={() => setCombinedSheetOpen(false)}
            className="min-h-0 flex-1 rounded-none"
          />
        </SwitchingPane>
      </div>
    );
  }

  return (
    <div ref={bodyRef} className="contents">
      <div className="border-b p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          autoFocus
          // Back would show the old workspace's projects mid-switch.
          disabled={workspaces.isSwitching}
          className="h-10 justify-start gap-1"
          onClick={() => setStep("projects")}
        >
          <ChevronLeft className="size-4" aria-hidden />
          {tSidebar("back")}
        </Button>
      </div>
      <WorkspaceList
        workspaces={workspaces}
        onChosen={() => setStep("projects")}
        className="overflow-y-auto p-2"
      />
    </div>
  );
}
