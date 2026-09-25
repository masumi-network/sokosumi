"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useSyncExternalStore } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { returnFocusTo } from "@/app/components/project-scope/use-project-scope";
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
  useCombinedScope,
  useCombinedWorkspaces,
  WorkspaceList,
  WorkspaceMark,
} from "./variant-combined-parts";

/**
 * The bottom sheet's open state. The sidebar trigger opens it from inside the
 * mobile sidebar sheet, which closes on the same tap, so the bottom sheet
 * lives with the header chip and the two share this flag.
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
 * project list, and one row there swaps in the workspace list.
 *
 * The chip is the sheet's trigger even when the sidebar button opens it: that
 * button unmounts with the sidebar sheet, so Radix returns focus to the chip,
 * and Create project finds the chip through its `aria-controls`.
 */
export function CombinedMobileChip() {
  const t = useTranslations("App.ProjectScope");
  const pathname = usePathname();
  const open = useCombinedSheetOpen();
  const scope = useCombinedScope();
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
          <CombinedSheetBody scope={scope} />
        </SheetContent>
      </Sheet>
      {scope.createDialog}
    </>
  );
}

/**
 * Mounted only while the sheet is open: it reads workspaces on each open, and
 * its step starts at the project list every time.
 */
function CombinedSheetBody({
  scope,
}: {
  scope: ReturnType<typeof useCombinedScope>;
}) {
  const tWorkspace = useTranslations("Components.OrganizationSwitcher");
  const tSidebar = useTranslations("App.Sidebar.Content.MenuItems");
  const workspaces = useCombinedWorkspaces();
  const [step, setStep] = useState<"projects" | "workspaces">("projects");

  if (step === "projects") {
    return (
      <>
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
          <span className="min-w-0 flex-1 truncate">
            {workspaces.active?.name}
          </span>
          <span className="sr-only">{tWorkspace("switchWorkspace")}</span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        </button>
        <ProjectScopeMenu
          selectedProjectId={scope.projectId}
          onSelect={scope.select}
          onCreate={scope.openCreate}
          onDone={() => setCombinedSheetOpen(false)}
          className="min-h-0 flex-1 rounded-none"
        />
      </>
    );
  }

  return (
    <>
      <div className="border-b p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          autoFocus
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
    </>
  );
}
