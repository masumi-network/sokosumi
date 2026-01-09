import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  return (
    <Button variant="outline" size="sm" type="button" className="gap-1.5">
      <Plus className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
