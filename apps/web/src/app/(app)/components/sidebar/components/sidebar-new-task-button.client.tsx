"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffectEvent } from "react";

import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";
import { useMarkFeatureSeen, useNewBadgeState } from "./feature-badges";

// Alt+N (Option+N on a Mac). Matched by physical key: on a Mac, Option+N is
// a dead key that starts "ñ", so `event.key` never reads "n".
const SHORTCUT_CODE = "KeyN";
const OPEN_SURFACE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * New task, the sidebar header's main action, so it alone sits on a quiet
 * filled surface: opens the New Task wizard scoped
 * to the reader's project, from a click or from Alt+N (Option+N) anywhere
 * outside an editable field. Absent, shortcut included, when the reader cannot create a
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

/** The icon button and the Alt+N shortcut it binds while mounted. */
function NewTaskShortcutButton({ openNewTask }: { openNewTask: () => void }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const { isMobile, setOpenMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();
  const shortcutLabel = useIsApplePlatform() ? "⌥N" : "Alt+N";

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
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      if (event.code !== SHORTCUT_CODE) return;
      if (isEditableKeyboardTarget(event.target)) return;
      // Inside an open dialog (the wizard itself included) or menu, the key belongs
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
          variant="ghost"
          size="icon"
          aria-keyshortcuts="Alt+N"
          onClick={handleOpen}
          className="bg-quinary hover:bg-quaternary relative size-10 shrink-0 md:size-8"
        >
          <SquarePen aria-hidden />
          <span className="sr-only">{t("newTask")}</span>
          <Suspense fallback={null}>
            <NewBadge />
          </Suspense>
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="flex items-center gap-2"
      >
        {t("newTask")}
        <Kbd className="opacity-70">{shortcutLabel}</Kbd>
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
