"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useCreateTaskModal } from "./create-task-modal";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  const { handleOpen } = useCreateTaskModal();

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={handleOpen}>
      <Plus className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
