"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { Button } from "@/components/ui/button";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";

/** Opens the New Task wizard, like the sidebar "New task" item. */
export function NewTaskButton({ className }: { className?: string }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const wizard = useOptionalNewTaskWizard();
  const { projectId } = useProjectScope();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();

  // Core rejects task creation without a seat, so the wizard would only fail.
  if (!wizard || !hasAssignedSeat) return null;

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className={className}
      onClick={() => wizard.openNewTaskWizard({ projectId })}
    >
      <Plus aria-hidden />
      {t("newTask")}
    </Button>
  );
}
