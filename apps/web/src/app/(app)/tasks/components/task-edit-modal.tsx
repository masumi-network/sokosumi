"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoworkerOption } from "@/lib/types/coworker";

import type {
  TaskFormInitialDesignMdAttachment,
  TaskFormLabels,
} from "./task-form";
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
    selectableStatuses: readonly TaskStatus[];
    runAt?: string | null;
  };
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  agentNameById: Map<string, string>;
  labels: TaskFormLabels;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
}

export function TaskEditModal({
  taskId,
  title,
  initialValues,
  coworkerOptions,
  projectOptions,
  agentNameById,
  labels,
  initialDesignMdAttachment = null,
}: TaskEditModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);
  // Path may be an identifier slug (`/tasks/SOK-12-fix-login/edit`) while
  // `taskId` is the uuid used for PATCH. Close by stripping `/edit`.
  const handleClose = useCallback(() => {
    const detailPath = pathname.endsWith("/edit")
      ? pathname.slice(0, -"/edit".length)
      : `/tasks/${taskId}`;
    router.replace(detailPath);
  }, [pathname, router, taskId]);

  const isOpen = pathname.endsWith("/edit");

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
        initialDesignMdAttachment={initialDesignMdAttachment}
        onCancel={handleClose}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={handleClose}
      />
    </TaskFormModal>
  );
}
