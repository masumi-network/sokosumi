"use client";

import { ChevronsUpDown, FolderKanban, Layers, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import {
  returnFocusTo,
  useProjectScopeSwitch,
} from "@/app/components/project-scope/use-project-scope";
import { useSelectedScopeProject } from "@/app/components/project-scope/use-scope-projects";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import {
  getScopeCreateOpener,
  openScopeCreate,
  resetScopeDialogs,
  setScopeCreateOpen,
  setScopeSheetOpen,
  useScopeCreateOpen,
  useScopeSheetOpen,
} from "./sidebar-project-scope-state";

/** The current scope as a name and a mark, for any trigger. */
export function useCurrentScope() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const selectedProject = useSelectedScopeProject(scope.projectId);
  // A project still loading reads as "Project", never as the workspace.
  const name =
    scope.projectId === null
      ? t("workspaceView")
      : (selectedProject?.name ?? t("label"));

  return {
    ...scope,
    name,
    /** "Project: Acme", for accessible names and the rail tooltip. */
    label: scope.projectId === null ? name : `${t("label")}: ${name}`,
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
  const pathname = usePathname();
  const open = useScopeSheetOpen();
  const createOpen = useScopeCreateOpen();
  const { projectId, name, label, mark, select } = useCurrentScope();
  const chipRef = useRef<HTMLButtonElement>(null);

  // The store outlives this chip, as when the reader leaves the app shell.
  useMountEffect(() => resetScopeDialogs);

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 shrink md:hidden",
          // A chat room's toolbar takes this row on phones. The sheet and the
          // dialog stay mounted: the sidebar row opens them through the store.
          isChatRoomPathname(pathname) && "hidden",
        )}
      >
        <Sheet open={open} onOpenChange={setScopeSheetOpen}>
          <SheetTrigger asChild>
            <Button
              ref={chipRef}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={label}
              title={name}
              data-testid="project-scope-sidebar-chip"
              className="h-11 max-w-[40vw] min-w-0 shrink gap-1.5 px-2 font-medium data-[state=open]:bg-accent"
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
            showCloseButton={false}
            aria-describedby={undefined}
            // A chat room hides the chip, so the sidebar row opens this sheet.
            onCloseAutoFocus={(event) => returnFocusTo(chipRef.current)(event)}
            className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl pb-[env(safe-area-inset-bottom)] motion-reduce:animate-none motion-reduce:transition-none"
          >
            <SheetHeader className="min-h-14 justify-center pe-16">
              <SheetTitle>{t("switchLabel")}</SheetTitle>
            </SheetHeader>
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-2 top-1.5 size-11"
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">{t("close")}</span>
              </Button>
            </SheetClose>
            <ProjectScopeMenu
              selectedProjectId={projectId}
              onSelect={select}
              onCreate={openScopeCreate}
              onDone={() => setScopeSheetOpen(false)}
              className="min-h-0 flex-1 rounded-none border-t"
            />
          </SheetContent>
        </Sheet>
      </div>
      <InlineCreateProjectModal
        open={createOpen}
        onOpenChange={setScopeCreateOpen}
        onCreated={({ projectId: createdId }) => select(createdId)}
        onCloseAutoFocus={(event) =>
          returnFocusTo(getScopeCreateOpener())(event)
        }
        creationSource="project_switcher"
      />
    </>
  );
}
