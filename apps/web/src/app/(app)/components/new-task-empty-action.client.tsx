"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { Button } from "@/components/ui/button";

/** The way out of an empty task, job or history list: start a task. */
export function NewTaskEmptyAction() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const wizard = useOptionalNewTaskWizard();
  const { projectId } = useProjectScope();

  if (!wizard) return null;

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => wizard.openNewTaskWizard({ projectId })}
    >
      <Plus aria-hidden />
      {t("newTask")}
    </Button>
  );
}
