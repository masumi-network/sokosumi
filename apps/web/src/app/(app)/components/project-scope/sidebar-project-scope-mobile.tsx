"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { returnFocusTo } from "@/app/components/project-scope/use-project-scope";
import { usePrefetchScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
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

import { ProjectScopeReason } from "./project-scope-required";
import {
  ScopeClosedBadge,
  useClearScope,
  useCurrentScope,
} from "./project-scope-trigger";
import {
  getScopeCreateOpener,
  openScopeCreate,
  resetScopeDialogs,
  selectCreatedProject,
  selectProjectScope,
  setScopeCreateOpen,
  setScopeSheetOpen,
  useScopeCreateOpen,
  useScopeRequest,
  useScopeSheetOpen,
} from "./sidebar-project-scope-state";

/**
 * Below md: a compact scope chip in the header that opens a bottom sheet.
 * While a project is picked, an × beside it returns to All projects.
 * A page that needs a project opens the same sheet (`openProjectScope`); a
 * required ask keeps it open on a tap outside.
 */
export function SidebarScopeMobileChip() {
  const prefetch = usePrefetchScopeProjects();
  const t = useTranslations("App.ProjectScope");
  const pathname = usePathname();
  const open = useScopeSheetOpen();
  const createOpen = useScopeCreateOpen();
  const request = useScopeRequest();
  const required = open && request?.required === true;
  const reasonId = useId();
  const { projectId, name, closed, label, mark, select } = useCurrentScope();
  const chipRef = useRef<HTMLButtonElement>(null);
  const clearScope = useClearScope(chipRef);

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
              onPointerDown={prefetch}
              className="h-11 max-w-[40vw] min-w-0 shrink gap-1.5 px-2 font-medium data-[state=open]:bg-accent"
            >
              {/* The mark's glyph names no size, so this box gives it one. */}
              <span aria-hidden className="flex shrink-0 [&>svg]:size-4">
                {mark}
              </span>
              <span className="min-w-0 truncate">{name}</span>
              {closed ? <ScopeClosedBadge /> : null}
              <ChevronsUpDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            aria-describedby={request?.reason ? reasonId : undefined}
            data-required={required || undefined}
            // A required ask closes on Esc or ×, not on a stray tap outside.
            onInteractOutside={(event) => {
              if (required) event.preventDefault();
            }}
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
            {request?.reason ? (
              <ProjectScopeReason id={reasonId} reason={request.reason} />
            ) : null}
            <ProjectScopeMenu
              selectedProjectId={projectId}
              onSelect={(id) => selectProjectScope(id, select)}
              onCreate={openScopeCreate}
              onDone={() => setScopeSheetOpen(false)}
              // The reason's own rule already sits above the list.
              className={cn(
                "min-h-0 flex-1 rounded-none",
                !request?.reason && "border-t",
              )}
            />
          </SheetContent>
        </Sheet>
        {projectId !== null && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("clearProject")}
            title={t("clearProject")}
            data-testid="project-scope-chip-clear"
            onClick={clearScope}
            className="text-muted-foreground hover:text-foreground size-11 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      <InlineCreateProjectModal
        open={createOpen}
        onOpenChange={setScopeCreateOpen}
        onCreated={({ projectId: createdId }) =>
          selectCreatedProject(createdId, select)
        }
        onCloseAutoFocus={(event) =>
          returnFocusTo(getScopeCreateOpener())(event)
        }
        creationSource="project_switcher"
      />
    </>
  );
}
