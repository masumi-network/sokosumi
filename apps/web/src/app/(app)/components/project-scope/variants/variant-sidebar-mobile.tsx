"use client";

import { ChevronsUpDown, FolderKanban, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The bottom sheet's open state, shared by the header chip that owns the sheet
 * and the sidebar row that hands off to it on mobile. The sidebar is itself a
 * sheet there and closes on the tap, so the menu cannot live inside it.
 */
let sheetOpen = false;
const listeners = new Set<() => void>();

function setScopeSheetOpen(next: boolean) {
  sheetOpen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openScopeSheet() {
  setScopeSheetOpen(true);
}

export function useScopeSheetOpen() {
  return useSyncExternalStore(
    subscribe,
    () => sheetOpen,
    () => false,
  );
}

/** The current scope as a name and a mark, for any trigger. */
export function useCurrentScope() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const { selectedProject } = useScopeProjects({
    search: "",
    selectedProjectId: scope.projectId,
  });
  // A project still loading reads as "Project", never as the workspace.
  const name =
    scope.projectId === null
      ? t("workspaceView")
      : (selectedProject?.name ?? t("label"));

  return {
    ...scope,
    name,
    /** "Project: Acme", for accessible names and the rail tooltip. */
    label: `${t("label")}: ${name}`,
    mark:
      scope.projectId === null ? (
        <Layers className="size-4 shrink-0" aria-hidden />
      ) : selectedProject ? (
        <ProjectAvatar
          name={selectedProject.name}
          logo={selectedProject.logo}
          className="size-5 shrink-0"
        />
      ) : (
        <FolderKanban className="size-4 shrink-0" aria-hidden />
      ),
  };
}

/** Below md: a compact scope chip in the header that opens a bottom sheet. */
export function SidebarScopeMobileChip() {
  const t = useTranslations("App.ProjectScope");
  const open = useScopeSheetOpen();
  const { projectId, name, label, mark, select, openCreate, createDialog } =
    useCurrentScope();

  return (
    <>
      <div className="flex min-w-0 shrink md:hidden">
        <Sheet open={open} onOpenChange={setScopeSheetOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={label}
              title={name}
              data-testid="project-scope-sidebar-chip"
              className="max-w-[40vw] min-w-0 gap-1.5 px-2 font-medium"
            >
              <span aria-hidden className="flex shrink-0">
                {mark}
              </span>
              <span className="min-w-0 truncate">{name}</span>
              <ChevronsUpDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            className="max-h-[85dvh] gap-0 rounded-t-lg pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="pr-12 pb-2">
              <SheetTitle>{t("switchLabel")}</SheetTitle>
            </SheetHeader>
            <ProjectScopeMenu
              selectedProjectId={projectId}
              onSelect={select}
              onCreate={openCreate}
              onDone={() => setScopeSheetOpen(false)}
              className="min-h-0 flex-1 rounded-none border-t"
            />
          </SheetContent>
        </Sheet>
      </div>
      {createDialog}
    </>
  );
}
