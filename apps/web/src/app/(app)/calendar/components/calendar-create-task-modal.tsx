"use client";

import { useCallback, useState } from "react";
import {
  CreateTaskModal,
  useCreateTaskModal,
} from "@/app/tasks/components/create-task-modal";
import type { TaskFormCreateHandler } from "@/app/tasks/components/task-form";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { createScheduledTask, createTask } from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CalendarCreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  lockProjectSelection?: boolean;
}

export function CalendarCreateTaskModal(props: CalendarCreateTaskModalProps) {
  const { formInstanceKey } = useCreateTaskModal();

  return <CalendarCreateTaskModalInstance key={formInstanceKey} {...props} />;
}

function CalendarCreateTaskModalInstance({
  coworkerOptions,
  projectOptions,
  lockProjectSelection = false,
}: CalendarCreateTaskModalProps) {
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  const handleCreateTask = useCallback<TaskFormCreateHandler>(
    async (input) => {
      if (
        input.status === TaskStatus.DRAFT ||
        !input.schedule ||
        input.schedule.mode === "none"
      ) {
        return createTask(input);
      }

      if (!input.assigneeId || input.assigneeSokoBotId) {
        throw new Error("A coworker is required to schedule a Calendar task");
      }

      const result = await createScheduledTask({
        operationId,
        source: input.projectId
          ? { type: "project", projectId: input.projectId }
          : { type: "workspace" },
        description: input.description,
        assigneeId: input.assigneeId,
        context: input.context,
        schedule: input.schedule,
      });
      if (result.ok) {
        setOperationId(crypto.randomUUID());
      }
      return result;
    },
    [operationId],
  );

  return (
    <CreateTaskModal
      coworkerOptions={coworkerOptions}
      projectOptions={projectOptions}
      lockProjectSelection={lockProjectSelection}
      onCreateTask={handleCreateTask}
    />
  );
}
