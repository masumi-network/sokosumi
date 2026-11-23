"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { projectPageSection } from "@/app/components/project-scope/project-scope-href";
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
 * While a project is picked, an × beside it returns to All projects. On a
 * project's own pages the chip takes the row's free width, holds its × inside
 * one pill, and the header drops the workspace switcher (You keeps it), so the
 * name reads whole.
 * A page that needs a project opens the same sheet (`openProjectScope`); a
 * required ask keeps it open on a tap outside.
 */
export function SidebarScopeMobileChip() {
  const prefetch = usePrefetchScopeProjects();
  const t = useTranslations("App.ProjectScope");
  const pathname = useChromePathname();
  const open = useScopeSheetOpen();
  const createOpen = useScopeCreateOpen();
  const request = useScopeRequest();
  const required = open && request?.required === true;
  const reasonId = useId();
  const { projectId, name, closed, label, mark, select } = useCurrentScope();
  const inProject = projectId !== null && projectPageSection(pathname) !== null;
  const chipRef = useRef<HTMLButtonElement>(null);
  const clearScope = useClearScope(chipRef);

  // The store outlives this chip, as when the reader leaves the app shell.
  useMountEffect(() => resetScopeDialogs);

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 shrink md:hidden",
          // -mx-1: the row's 8px gaps shrink to 4px beside the pill, so the
          // name gets the width (back, bell and Search keep their 40px).
          inProject && "bg-muted -mx-1 h-10 flex-1 items-center rounded-full",
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
              title={name}
              data-testid="project-scope-sidebar-chip"
              onPointerDown={prefetch}
              className={cn(
                "min-w-0 shrink gap-1.5 px-2 font-medium data-[state=open]:bg-accent",
                inProject
                  ? // Tight insets leave the name about 120px at 375.
                    "h-10 flex-1 justify-start gap-1 rounded-full has-[>svg]:ps-2 has-[>svg]:pe-1"
                  : "h-11 max-w-[40vw]",
              )}
            >
              {/* The mark's glyph names no size, so this box gives it one. */}
              <span
                aria-hidden
                className={cn(
                  "flex shrink-0 [&>svg]:size-4",
                  inProject &&
                    "[&>*]:size-4 [&_[data-slot=avatar-fallback]]:text-2xs",
                )}
              >
                {mark}
              </span>
              {/* Named by its content, not aria-label: the mark's initial is
                  visible text, and an aria-label that skips it fails WCAG
                  2.5.3. The whole label is read out; the name shows. */}
              <span className="sr-only">{label}</span>
              <span aria-hidden className="min-w-0 truncate">
                {name}
              </span>
              {closed ? <ScopeClosedBadge /> : null}
              <ChevronsUpDown
                className={cn(
                  "text-muted-foreground shrink-0",
                  inProject ? "size-3" : "size-3.5",
                )}
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
              onSelectAll={request ? undefined : () => select(null)}
              onCreate={openScopeCreate}
              onDone={() => setScopeSheetOpen(false)}
              excludeCmo={request?.excludeCmo}
              // The reason's own rule already sits above the list.
              className={cn(
                "min-h-0 flex-1 rounded-none",
                !request?.reason && "border-t",
              )}
            />
          </SheetContent>
        </Sheet>
        {inProject ? (
          <span aria-hidden className="bg-border h-5 w-px shrink-0" />
        ) : null}
        {projectId !== null && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("clearProject")}
            title={t("clearProject")}
            data-testid="project-scope-chip-clear"
            onClick={clearScope}
            className={cn(
              "text-muted-foreground hover:text-foreground shrink-0",
              inProject ? "size-10 rounded-full" : "size-11",
            )}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      <InlineCreateProjectModal
        open={createOpen}
        onOpenChange={setScopeCreateOpen}
        onCreated={({ projectId: createdId, project }) =>
          selectCreatedProject(createdId, select, project?.websiteUrl)
        }
        onCloseAutoFocus={(event) =>
          returnFocusTo(getScopeCreateOpener())(event)
        }
        creationSource="project_switcher"
      />
    </>
  );
}
