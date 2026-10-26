"use client";

/**
 * PROTOTYPE, throwaway: where New task lives once it leaves the sidebar nav.
 *   d  a "New task" button in the top bar, left of search
 *   e  a compose icon beside the sidebar's collapse button
 * Both open the wizard with C (no modifiers, never while typing).
 * See `components/prototype/sidebar-prototype.client.tsx`.
 */

import { Plus, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  type SidebarPrototypeVariant,
  useSidebarPrototypeVariant,
} from "@/components/prototype/sidebar-prototype.client";
import { Button } from "@/components/ui/button";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

const SHORTCUT_HINT = "New task (C)";

/** The wizard opener for `variant`, or null when that placement is off. */
function useNewTaskPlacement(variant: SidebarPrototypeVariant) {
  const active = useSidebarPrototypeVariant() === variant;
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
  const open = useNewTaskPlacement("d");
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
  const open = useNewTaskPlacement("e");
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
