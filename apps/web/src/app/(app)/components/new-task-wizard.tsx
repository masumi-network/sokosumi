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
  /** Unmount the wizard when the modal closes (dismiss, error, or success). */
  onClose?: () => void;
}

/**
 * The New Task wizard opened in place from the sidebar. Mounted already open
 * by `NewTaskWizardProvider`; loads its assignee and project lists, then
 * hands over to `CreateTaskModal`. Closing the modal unmounts the wizard.
 */
export function NewTaskWizard({ instance, onClose }: NewTaskWizardProps) {
  return (
    <CreateTaskModalProvider initialOpen>
      <NewTaskWizardModal instance={instance} onClose={onClose} />
    </CreateTaskModalProvider>
  );
}

function NewTaskWizardModal({ instance, onClose }: NewTaskWizardProps) {
  const { handleClose, open } = useCreateTaskModal();
  const tTasksErrors = useTranslations("App.Tasks.Errors");
  const { data: options, isError } = useQuery({
    // Keyed per open so the lists always belong to the current workspace.
    queryKey: ["new-task-wizard-options", instance],
    queryFn: () => loadNewTaskWizardOptions(),
    select: toWizardOptions,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (!isError) return;
    toast.error(tTasksErrors("loadCreateTask"));
    handleClose();
  }, [handleClose, isError, tTasksErrors]);

  useEffect(() => {
    if (open) return;
    onClose?.();
  }, [onClose, open]);

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
