"use client";

import { Plus } from "lucide-react";

import { useCreateTaskModal } from "./create-task-modal";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  const { handleOpen } = useCreateTaskModal();

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
    >
      <Plus className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
