"use client";

/**
 * PROTOTYPE, throwaway: where New task lives once it leaves the sidebar nav.
 *   d  a "New task" button in the top bar, left of search
 *   e  a compose icon beside the sidebar's collapse button
 *   f  Linear-style sidebar header: search and compose icons, no collapse
 *      button (the sidebar hides completely; the top bar reopens it)
 * Each opens the wizard with C (no modifiers, never while typing).
 * See `components/prototype/sidebar-prototype.client.tsx`.
 */

import { PanelLeft, Plus, Search, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  type SidebarPrototypeVariant,
  useSidebarPrototypeVariant,
} from "@/components/prototype/sidebar-prototype.client";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

const SHORTCUT_HINT = "New task (C)";

/** The wizard opener for `variant`, or null when that placement is off. */
function useNewTaskPlacement(variants: readonly SidebarPrototypeVariant[]) {
  const active = variants.includes(useSidebarPrototypeVariant());
  const wizard = useOptionalNewTaskWizard();
  const { projectId } = useProjectScope();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const open =
    active && wizard && hasAssignedSeat
      ? () => wizard.openNewTaskWizard({ projectId })
      : null;

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "c" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      open?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return open;
}

export function NewTaskPrototypeHeaderButton() {
  const open = useNewTaskPlacement(["d"]);
  if (!open) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      title={SHORTCUT_HINT}
      className="hidden shrink-0 md:inline-flex"
      onClick={open}
    >
      <Plus aria-hidden />
      New task
      <kbd className="border-primary-solid-foreground text-primary-solid-foreground ml-1 rounded-sm border px-1 font-sans text-2xs leading-4">
        C
      </kbd>
    </Button>
  );
}

export function NewTaskPrototypeSidebarIcon({
  className,
}: {
  className?: string;
}) {
  const open = useNewTaskPlacement(["e", "f"]);
  if (!open) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="New task"
      title={SHORTCUT_HINT}
      onClick={open}
      className={cn("size-10 shrink-0 md:size-8", className)}
    >
      <SquarePen aria-hidden />
    </Button>
  );
}

/** Variant f: search beside compose, as Linear's sidebar header has it. */
export function SearchPrototypeSidebarIcon() {
  const active = useSidebarPrototypeVariant() === "f";
  const historySearch = useOptionalHistorySearch();
  if (!active || !historySearch) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      title={`Search (${historySearch.searchShortcutLabel})`}
      onClick={historySearch.openHistorySearch}
      className="size-10 shrink-0 md:size-8"
    >
      <Search aria-hidden />
    </Button>
  );
}

/**
 * Variant f: the hidden sidebar's way back, at the start of the top bar.
 * Shown only while the sidebar is closed; ⌘B toggles it too. It carries the
 * mobile Chats tab's unread dot, since the hidden list cannot show one.
 */
export function OpenSidebarPrototypeButton() {
  const active = useSidebarPrototypeVariant() === "f";
  const { open, isMobile, toggleSidebar } = useSidebar();
  if (!active || open || isMobile) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Show sidebar"
      title="Show sidebar (⌘B)"
      onClick={toggleSidebar}
      className="relative -ml-2 hidden size-8 shrink-0 md:inline-flex"
    >
      <PanelLeft aria-hidden />
      <SidebarUnreadDot />
    </Button>
  );
}

/** Mounted only while the sidebar is hidden, so its reader runs only then. */
function SidebarUnreadDot() {
  const { showUnreadDot } = useChatTabUnreadPresence();
  if (!showUnreadDot) {
    return null;
  }
  return (
    <span
      data-testid="sidebar-unread-dot"
      className="bg-primary ring-sidebar absolute top-1 right-1 size-1.5 rounded-full ring-2"
    >
      <span className="sr-only">Unread chats</span>
    </span>
  );
}
