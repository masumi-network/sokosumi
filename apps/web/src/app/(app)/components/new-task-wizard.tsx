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

type NewTaskWizardData = Awaited<ReturnType<typeof loadNewTaskWizardOptions>>;

function toWizardOptions(data: NewTaskWizardData) {
  return {
    ...data,
    agentNameById: new Map(Object.entries(data.agentNameById)),
  };
}

interface NewTaskWizardProps {
  /** Which open this is; a new number means a fresh wizard with fresh lists. */
  instance: number;
  /** Runs when the modal closes (dismiss, load error, or success). */
  onClose?: () => void;
}

/**
 * The New Task wizard opened in place from the sidebar. Mounted already open
 * by `NewTaskWizardProvider`; loads its assignee and project lists, then
 * hands over to `CreateTaskModal`. Closing the modal reports back through
 * `onClose`, and the provider unmounts the wizard.
 */
export function NewTaskWizard({ instance, onClose }: NewTaskWizardProps) {
  return (
    <CreateTaskModalProvider initialOpen onClose={onClose}>
      <NewTaskWizardModal instance={instance} />
    </CreateTaskModalProvider>
  );
}

function NewTaskWizardModal({
  instance,
}: Pick<NewTaskWizardProps, "instance">) {
  const { handleClose } = useCreateTaskModal();
  const tTasksErrors = useTranslations("App.Tasks.Errors");
  const { data: options, isError } = useQuery({
    // Keyed per open so the lists always belong to the current workspace.
    queryKey: ["new-task-wizard-options", instance],
    queryFn: () => loadNewTaskWizardOptions(),
    select: toWizardOptions,
    gcTime: 0,
    refetchOnWindowFocus: false,
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
      agentNameById={options?.agentNameById}
      initialDesignMdAttachment={options?.designMdAttachment ?? null}
      isLoadingOptions={options === undefined}
    />
  );
}
