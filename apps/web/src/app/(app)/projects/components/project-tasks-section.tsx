"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ProjectTaskPickerDialog } from "@/app/projects/components/project-task-picker-dialog";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TimeAgo } from "@/components/time-ago";
import { Button } from "@/components/ui/button";
import { addProjectTask } from "@/lib/actions/project/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskListItem } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

interface ProjectTasksSectionLabels {
  title: string;
  empty: string;
  add: string;
  viewAll: string;
  pickerTitle: string;
  pickerDescription: string;
  pickerSearchPlaceholder: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerError: string;
  errors: {
    add: string;
  };
}

interface ProjectTasksSectionProps {
  projectId: string;
  tasks: TaskListItem[];
  labels: ProjectTasksSectionLabels;
}

export function ProjectTasksSection({
  projectId,
  tasks,
  labels,
}: ProjectTasksSectionProps) {
  const router = useRouter();
  const locale = useLocale();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();

  const sortedTasks = [...tasks].sort(
    (firstTask, secondTask) =>
      new Date(secondTask.createdAt).getTime() -
      new Date(firstTask.createdAt).getTime(),
  );

  function handleSelectTask(taskId: string) {
    setPendingTaskId(taskId);

    startAddTransition(async () => {
      try {
        await addProjectTask({ projectId, taskId });
        setIsPickerOpen(false);
        router.refresh();
      } catch {
        toast.error(labels.errors.add);
      } finally {
        setPendingTaskId(null);
      }
    });
  }

  return (
    <section className="space-y-4" data-testid="project-tasks-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {labels.title}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/tasks?projectId=${projectId}`}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {labels.viewAll}
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsPickerOpen(true)}
          >
            <Plus className="size-4" aria-hidden />
            {labels.add}
          </Button>
        </div>
      </div>

      {sortedTasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.empty}</p>
      ) : (
        <div className="divide-border/50 -mx-2 divide-y px-0">
          {sortedTasks.map((task) => {
            const secondary = task.description?.trim() || null;

            return (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className={cn(
                  "flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4",
                  "-mx-2 rounded-lg px-4 py-3 transition-colors",
                  "hover:bg-muted/50",
                  "active:scale-[0.995]",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-foreground line-clamp-1 text-sm font-medium">
                    {task.name}
                  </span>
                  {secondary ? (
                    <p className="text-muted-foreground/70 line-clamp-1 text-xs break-all">
                      {secondary}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs sm:gap-4">
                  <TaskStatusBadge
                    status={task.status as TaskStatus}
                    className="w-fit shrink-0 rounded-sm"
                  />
                  <span className="text-muted-foreground shrink-0">
                    <TimeAgo date={task.createdAt} locale={locale} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <ProjectTaskPickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        isAdding={isAdding}
        pendingTaskId={pendingTaskId}
        onSelectTask={handleSelectTask}
        labels={{
          pickerTitle: labels.pickerTitle,
          pickerDescription: labels.pickerDescription,
          pickerSearchPlaceholder: labels.pickerSearchPlaceholder,
          pickerEmpty: labels.pickerEmpty,
          pickerLoading: labels.pickerLoading,
          pickerError: labels.pickerError,
        }}
      />
    </section>
  );
}
