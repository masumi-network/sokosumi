import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface AddTaskButtonProps {
  label: string;
}

export function AddTaskButton({ label }: AddTaskButtonProps) {
  return (
    <Button variant="outline" size="sm" className="gap-2" asChild>
      <Link href="/tasks/new">
        <Plus className="size-4" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}
