import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      className="gap-1.5"
    >
      <Link
        href="/tasks/new"
        className="flex w-full items-center justify-center gap-2"
      >
        <Plus className="size-4" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}
