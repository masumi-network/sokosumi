"use client";

/**
 * PROTOTYPE, throwaway: the Linear-style sidebar header and top-bar toggle
 * for variants b–e. New task (and, in b–d, search) leave the nav and the top bar
 * for the sidebar header; how those two read as buttons is the question:
 *   b  plain icons
 *   c  icons on button shapes: search on a quiet fill, New task on primary
 *   d  search on a quiet fill, New task as a labelled "New" button
 *   e  search stays in the top bar; New task alone, on primary
 * C opens the wizard (no modifiers, never while typing).
 * See `components/prototype/sidebar-prototype.client.tsx`.
 */

import { PanelLeft, Plus, Search, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { useSidebarPrototypeVariant } from "@/components/prototype/sidebar-prototype.client";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

const ICON_BUTTON_CLASS = "size-10 shrink-0 md:size-8";

/** The New task opener in variants b–e (with its C shortcut), else null. */
function useNewTaskOpener() {
  const active = useSidebarPrototypeVariant() !== "a";
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

/** Search, then New task, at the end of the sidebar header (b–d). */
export function SidebarHeaderPrototypeActions() {
  const variant = useSidebarPrototypeVariant();
  const historySearch = useOptionalHistorySearch();
  const openNewTask = useNewTaskOpener();
  if (variant === "a") {
    return null;
  }
  const shaped = variant !== "b";
  // e keeps search in the top bar, so New task is the header's only action.
  const showSearch = variant !== "e";

  return (
    <div className="flex shrink-0 items-center gap-1.5 group-data-[collapsible=icon]:hidden">
      {historySearch && showSearch ? (
        <Button
          type="button"
          variant={shaped ? "secondary" : "ghost"}
          size="icon"
          aria-label="Search"
          aria-keyshortcuts="Meta+K Control+K"
          title={`Search (${historySearch.searchShortcutLabel})`}
          onClick={historySearch.openHistorySearch}
          className={ICON_BUTTON_CLASS}
        >
          <Search aria-hidden />
        </Button>
      ) : null}
      {openNewTask && variant === "d" ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          title="New task (C)"
          onClick={openNewTask}
          className="h-10 shrink-0 md:h-8"
        >
          <Plus aria-hidden />
          New
        </Button>
      ) : openNewTask ? (
        <Button
          type="button"
          variant={shaped ? "primary" : "ghost"}
          size="icon"
          aria-label="New task"
          title="New task (C)"
          onClick={openNewTask}
          className={ICON_BUTTON_CLASS}
        >
          <SquarePen aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * b–e: one sidebar toggle at the start of the top bar, in place of the
 * sidebar header's collapse button. ⌘B toggles it too. While the sidebar is
 * hidden it carries the mobile Chats tab's unread dot, since the hidden list
 * cannot show one.
 */
export function SidebarTogglePrototypeButton() {
  const active = useSidebarPrototypeVariant() !== "a";
  const { open, isMobile, toggleSidebar } = useSidebar();
  if (!active || isMobile) {
    return null;
  }
  const label = open ? "Hide sidebar" : "Show sidebar";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-expanded={open}
      title={`${label} (⌘B)`}
      onClick={toggleSidebar}
      className={cn("relative -ml-2 hidden md:inline-flex", ICON_BUTTON_CLASS)}
    >
      <PanelLeft aria-hidden />
      {open ? null : <SidebarUnreadDot />}
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
