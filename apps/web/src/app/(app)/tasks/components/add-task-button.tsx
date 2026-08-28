"use client";

import { Plus } from "lucide-react";

import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";

import { useCreateTaskModal } from "./create-task-modal";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  const { handleOpen } = useCreateTaskModal();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();

  if (!hasAssignedSeat) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      data-tasks-add-task-column-anchor
      className="text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors"
    >
      <Plus className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
