"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import type { TaskFormLabels } from "./task-form";
import { TaskForm } from "./task-form";
import { TaskFormModal } from "./task-form-modal";

interface TaskEditModalProps {
  taskId: string;
  title: string;
  initialValues: {
    name: string;
    description: string;
    assigneeId: string;
    assigneeSokoBotId?: string | null;
    assigneeUserId?: string | null;
    projectId?: string | null;
    status: TaskStatus;
    metadata?: string | null;
    nextRunAt?: string | null;
  };
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  agentNameById: Map<string, string>;
  labels: TaskFormLabels;
  /** Precondition for every schedule write made from this render. */
  scheduleRevision: number;
  /**
   * Durable future exceptions a full-series edit would cancel, or `null` when
   * the ledger could not be read.
   */
  futureExceptionCount: number | null;
}

export function TaskEditModal({
  taskId,
  title,
  initialValues,
  coworkerOptions,
  projectOptions,
  agentNameById,
  labels,
  scheduleRevision,
  futureExceptionCount,
}: TaskEditModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);
  const handleClose = useCallback(() => {
    router.replace(`/tasks/${taskId}`);
  }, [router, taskId]);

  const isOpen = pathname === `/tasks/${taskId}/edit`;

  return (
    <TaskFormModal
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
      title={title}
      cancelLabel={labels.cancel}
      isDismissDisabled={isDismissDisabled}
    >
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={labels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        agentNameById={agentNameById}
        taskId={taskId}
        initialValues={initialValues}
        scheduleRevision={scheduleRevision}
        futureExceptionCount={futureExceptionCount}
        onCancel={handleClose}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={handleClose}
      />
    </TaskFormModal>
  );
}
