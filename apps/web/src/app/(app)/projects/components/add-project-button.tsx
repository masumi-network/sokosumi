"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useCreateProjectModal } from "./create-project-modal";

interface AddProjectButtonProps {
  label: string;
  className?: string;
}

export function AddProjectButton({ label, className }: AddProjectButtonProps) {
  const { handleOpen } = useCreateProjectModal();

  return (
    <Button
      type="button"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={handleOpen}
    >
      <Plus className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
