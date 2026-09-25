"use client";

import { ChevronsUpDown, FolderKanban, Layers } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useScopeProjects } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

import type { ScopeSlots } from "./scope-variants";

/**
 * A bare key. Cmd/Ctrl+K is history search, and Cmd/Ctrl+Shift+P opens a
 * private window in Firefox, which a page cannot take back.
 */
const SHORTCUT_KEY = "p";
const SHORTCUT_LABEL = "P";

/** Surfaces that own their keys: a bare P there types, filters or picks. */
const KEY_OWNING_SURFACE =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"]';

const DIALOG_MENU_CLASS = cn(
  "rounded-none",
  "**:data-[slot=command-input-wrapper]:h-12",
  "**:data-[slot=command-list]:h-[min(60dvh,26rem)] **:data-[slot=command-list]:max-h-none",
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground",
  "[&_[cmdk-group]]:px-2 [&_[cmdk-item]]:py-2.5",
);

const SHEET_MENU_CLASS = cn(
  "min-h-0 flex-1 rounded-none bg-transparent",
  "**:data-[slot=command-input-wrapper]:h-12",
  "**:data-[slot=command-list]:min-h-0 **:data-[slot=command-list]:flex-1 **:data-[slot=command-list]:max-h-none",
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:py-3",
);

/** The scope in hand: an avatar and name, or the workspace view. */
function ScopePillLabel({ projectId }: { projectId: string | null }) {
  const t = useTranslations("App.ProjectScope");
  const { selectedProject } = useScopeProjects({
    search: "",
    selectedProjectId: projectId,
  });

  if (projectId === null) {
    return (
      <>
        <Layers className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t("workspaceView")}</span>
      </>
    );
  }
  if (!selectedProject) {
    // Still loading, or a project the list does not know.
    return (
      <>
        <FolderKanban className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t("label")}</span>
      </>
    );
  }
  return (
    <>
      <ProjectAvatar
        name={selectedProject.name}
        logo={selectedProject.logo}
        className="size-5 shrink-0 rounded-md"
      />
      <span className="min-w-0 truncate">{selectedProject.name}</span>
    </>
  );
}

interface ScopePillProps extends ComponentProps<typeof Button> {
  projectId: string | null;
}

/** The trigger both slots share. Radix's trigger adds the popup ARIA. */
function ScopePill({
  projectId,
  className,
  children,
  ...props
}: ScopePillProps) {
  const t = useTranslations("App.ProjectScope");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="project-scope-command-trigger"
      className={cn(
        "min-w-0 justify-start gap-2 rounded-full px-2 has-[>svg]:px-2",
        className,
      )}
      {...props}
    >
      <span className="sr-only">{t("switchLabel")}: </span>
      <ScopePillLabel projectId={projectId} />
      {children}
    </Button>
  );
}

/** Opens the dialog on the bare key, unless the reader is typing or picking. */
function useScopeShortcut(
  triggerRef: RefObject<HTMLButtonElement | null>,
  open: () => void,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key?.toLowerCase() !== SHORTCUT_KEY) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest(KEY_OWNING_SURFACE)
      ) {
        return;
      }
      // The pill hides below `sm` and on room routes below `md`. A hidden
      // pill advertises no key, so the key does nothing there.
      if (!triggerRef.current?.getClientRects().length) return;
      event.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerRef, open]);
}

/** `header-center`, `sm` and up: the pill, its key, and a centred dialog. */
function CommandScopeDesktop() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openDialog = useCallback(() => setOpen(true), []);
  useScopeShortcut(triggerRef, openDialog);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <ScopePill
            ref={triggerRef}
            projectId={scope.projectId}
            aria-keyshortcuts={SHORTCUT_LABEL}
            className="max-w-64 shrink-0 self-center pr-1 has-[>svg]:pr-1"
          >
            <kbd
              aria-hidden
              className="text-muted-foreground bg-muted ml-auto shrink-0 rounded-full border px-1.5 font-sans text-xs"
            >
              {SHORTCUT_LABEL}
            </kbd>
          </ScopePill>
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <DialogTitle className="sr-only">{t("switchLabel")}</DialogTitle>
          <ProjectScopeMenu
            selectedProjectId={scope.projectId}
            onSelect={scope.select}
            onCreate={scope.openCreate}
            onDone={() => setOpen(false)}
            className={DIALOG_MENU_CLASS}
          />
        </DialogContent>
      </Dialog>
      {scope.createDialog}
    </>
  );
}

/** `header-mobile`, below `sm`: the pill and a tall bottom sheet. */
function CommandScopeMobile() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const [open, setOpen] = useState(false);
  // Room routes give the header row to the room toolbar below `md`.
  const isRoom = isChatRoomPathname(usePathname());
  if (isRoom) return null;

  return (
    <div className="flex min-w-0 shrink sm:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <ScopePill projectId={scope.projectId} className="h-9 max-w-full">
            <ChevronsUpDown
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
          </ScopePill>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="h-[90dvh] gap-0 rounded-t-2xl p-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle>{t("switchLabel")}</SheetTitle>
          </SheetHeader>
          <ProjectScopeMenu
            selectedProjectId={scope.projectId}
            onSelect={scope.select}
            onCreate={scope.openCreate}
            onDone={() => setOpen(false)}
            className={SHEET_MENU_CLASS}
          />
        </SheetContent>
      </Sheet>
      {scope.createDialog}
    </div>
  );
}

/** SOK-1202 variant "command": a header pill that opens a command dialog. */
export const commandSlots: ScopeSlots = {
  "header-center": CommandScopeDesktop,
  "header-mobile": CommandScopeMobile,
};
