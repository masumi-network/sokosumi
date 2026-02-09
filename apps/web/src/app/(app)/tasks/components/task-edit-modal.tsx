"use client";

import type { TaskStatus } from "@sokosumi/database";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

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
    coworkerId: string;
    status: TaskStatus;
  };
  coworkerOptions: CoworkerOption[];
  labels: TaskFormLabels;
}

export function TaskEditModal({
  taskId,
  title,
  initialValues,
  coworkerOptions,
  labels,
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
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={labels}
        coworkerOptions={coworkerOptions}
        taskId={taskId}
        initialValues={initialValues}
        onCancel={handleClose}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={handleClose}
      />
    </TaskFormModal>
  );
}
