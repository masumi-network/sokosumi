"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffectEvent } from "react";

import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";
import { useMarkFeatureSeen, useNewBadgeState } from "./feature-badges";

const SHORTCUT_KEY = "c";
const OPEN_SURFACE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * New task, the sidebar header's one action: opens the New Task wizard scoped
 * to the reader's project, from a click or from C anywhere outside an
 * editable field. Absent, shortcut included, when the reader cannot create a
 * Task (no assigned seat, or the Instant Nav shell outside the wizard).
 */
export function SidebarNewTaskButton() {
  return (
    <Suspense fallback={null}>
      <ScopedNewTaskButton />
    </Suspense>
  );
}

function ScopedNewTaskButton() {
  const openNewTask = useNewTaskOpener();

  // Mounted only when the reader can create a Task, so the shortcut is bound
  // only then.
  return openNewTask ? (
    <NewTaskShortcutButton openNewTask={openNewTask} />
  ) : null;
}

/** The icon button and the C shortcut it binds while mounted. */
function NewTaskShortcutButton({ openNewTask }: { openNewTask: () => void }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const { isMobile, setOpenMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

  function handleOpen() {
    markFeatureSeen(AnnouncedFeature.NEW_TASK);
    openNewTask();
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  const handleShortcut = useEffectEvent(handleOpen);

  useMountEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== SHORTCUT_KEY) return;
      if (isEditableKeyboardTarget(event.target)) return;
      // Inside an open dialog (the wizard itself included) or menu, C belongs
      // to that surface; opening again would remount the wizard and drop
      // what the reader entered.
      if (
        event.target instanceof Element &&
        event.target.closest(OPEN_SURFACE_SELECTOR)
      ) {
        return;
      }
      event.preventDefault();
      handleShortcut();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="primary"
          size="icon"
          aria-keyshortcuts={SHORTCUT_KEY.toUpperCase()}
          onClick={handleOpen}
          className="relative size-10 shrink-0 md:size-8"
        >
          <SquarePen aria-hidden />
          <span className="sr-only">{t("newTask")}</span>
          <Suspense fallback={null}>
            <NewBadge />
          </Suspense>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {t("newTaskShortcut", { shortcut: SHORTCUT_KEY.toUpperCase() })}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The New task Badge campaign's New badge: an icon button has no room for the
 * nav row's pill, so it is a dot on the corner, and the button's accessible
 * name gets ", New" from the hidden copy. Leaving, it fades on opacity alone;
 * reduced motion skips the fade.
 */
function NewBadge() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const state = useNewBadgeState(AnnouncedFeature.NEW_TASK);
  if (state === "none") {
    return null;
  }

  return (
    <>
      <span
        aria-hidden
        data-slot="sidebar-new-task-badge"
        className={cn(
          "bg-primary ring-sidebar absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2",
          "transition-opacity duration-200 ease-out motion-reduce:transition-none",
          state === "fading" && "opacity-0",
        )}
      />
      <span className="sr-only">, {t("new")}</span>
    </>
  );
}
