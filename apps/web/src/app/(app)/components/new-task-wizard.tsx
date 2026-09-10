"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { loadNewTaskWizardOptions } from "@/app/tasks/actions";
import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "@/app/tasks/components/create-task-modal";

interface NewTaskWizardProps {
  /** Which open this is; a new number means a fresh wizard with fresh lists. */
  instance: number;
}

/**
 * The New Task wizard opened in place from the sidebar. Mounted already open
 * by `NewTaskWizardProvider`; loads its assignee and project lists, then
 * hands over to `CreateTaskModal`, which closes itself.
 */
export function NewTaskWizard({ instance }: NewTaskWizardProps) {
  return (
    <CreateTaskModalProvider initialOpen>
      <NewTaskWizardModal instance={instance} />
    </CreateTaskModalProvider>
  );
}

function NewTaskWizardModal({ instance }: NewTaskWizardProps) {
  const { handleClose } = useCreateTaskModal();
  const tTasksErrors = useTranslations("App.Tasks.Errors");
  const { data: options, isError } = useQuery({
    // Keyed per open so the lists always belong to the current workspace.
    queryKey: ["new-task-wizard-options", instance],
    queryFn: () => loadNewTaskWizardOptions(),
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!isError) return;
    toast.error(tTasksErrors("loadCreateTask"));
    handleClose();
  }, [handleClose, isError, tTasksErrors]);

  return (
    <CreateTaskModal
      coworkerOptions={options?.coworkerOptions ?? []}
      projectOptions={options?.projectOptions ?? []}
      isLoadingOptions={options === undefined}
    />
  );
}
