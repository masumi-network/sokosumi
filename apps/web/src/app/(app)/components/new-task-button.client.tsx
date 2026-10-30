"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { Button } from "@/components/ui/button";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";

/**
 * Opens the New Task wizard scoped to the reader's project, or null when the
 * reader cannot create a Task here: outside the wizard's provider (the Instant
 * Nav shell) or without an assigned Organization seat, since Core rejects task
 * creation without one and the wizard would only fail.
 */
export function useNewTaskOpener(): (() => void) | null {
  const wizard = useOptionalNewTaskWizard();
  const { projectId } = useProjectScope();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();

  if (!wizard || !hasAssignedSeat) return null;
  return () => wizard.openNewTaskWizard({ projectId });
}

/** Opens the New Task wizard, like the sidebar header's New task button. */
export function NewTaskButton({ className }: { className?: string }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const openNewTask = useNewTaskOpener();

  if (!openNewTask) return null;

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className={className}
      onClick={openNewTask}
    >
      <Plus aria-hidden />
      {t("newTask")}
    </Button>
  );
}
