"use client";

import { CreateTaskModal } from "@/app/tasks/components/create-task-modal";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CalendarCreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  lockProjectSelection?: boolean;
}

/**
 * A Calendar slot opens the ordinary create form with the slot's time as its
 * Run at; the Task is created like any other (ADR 0041).
 */
export function CalendarCreateTaskModal({
  coworkerOptions,
  projectOptions,
  lockProjectSelection = false,
}: CalendarCreateTaskModalProps) {
  return (
    <CreateTaskModal
      coworkerOptions={coworkerOptions}
      projectOptions={projectOptions}
      lockProjectSelection={lockProjectSelection}
    />
  );
}
