import { ArrowLeft, Pencil, Trash } from "lucide-react";
import Link from "next/link";

import { type TaskCardData } from "@/app/tasks/types";
import { Button } from "@/components/ui/button";

interface TaskDetailHeaderProps {
  task: TaskCardData;
  labels: {
    back: string;
    budget: string;
    actions: {
      edit: string;
      delete: string;
    };
  };
}

export function TaskDetailHeader({ task, labels }: TaskDetailHeaderProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <Link href="/tasks" aria-label={labels.back}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={labels.back}
            >
              <ArrowLeft className="size-4" />
              <span className="sr-only">{labels.back}</span>
            </Button>
          </Link>

          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl leading-tight font-semibold">
                {task.title}
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <Pencil className="size-4" aria-hidden />
            <span>{labels.actions.edit}</span>
          </Button>
          <Button variant="destructive" size="sm" className="gap-2">
            <Trash className="size-4" aria-hidden />
            <span>{labels.actions.delete}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
