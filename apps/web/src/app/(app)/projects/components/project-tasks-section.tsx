"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ProjectTaskPickerDialog } from "@/app/projects/components/project-task-picker-dialog";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TimeAgo } from "@/components/time-ago";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  addProjectTask,
  removeProjectTask,
} from "@/lib/actions/project/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskListItem } from "@/lib/clients/generated/core/types.gen";

interface ProjectTasksSectionLabels {
  title: string;
  empty: string;
  add: string;
  remove: string;
  pickerTitle: string;
  pickerDescription: string;
  pickerSearchPlaceholder: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerError: string;
  confirmRemove: string;
  cancel: string;
  errors: {
    add: string;
    remove: string;
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
  const [taskToRemove, setTaskToRemove] = useState<TaskListItem | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();
  const [isRemoving, startRemoveTransition] = useTransition();

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

  function handleRemoveTask() {
    if (!taskToRemove) return;

    const taskId = taskToRemove.id;
    setPendingTaskId(taskId);

    startRemoveTransition(async () => {
      try {
        await removeProjectTask({ projectId, taskId });
        setTaskToRemove(null);
        router.refresh();
      } catch {
        toast.error(labels.errors.remove);
      } finally {
        setPendingTaskId(null);
      }
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {labels.title}
        </h2>
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

      {sortedTasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {sortedTasks.map((task) => (
            <li
              key={task.id}
              className="bg-muted/40 border-border/50 flex items-center gap-2 rounded-lg border p-3"
            >
              <Link
                href={`/tasks/${task.id}`}
                className="hover:text-primary grid min-w-0 flex-1 gap-2 transition-colors sm:grid-cols-[minmax(0,1fr)_140px_96px] sm:items-center"
              >
                <p className="truncate text-sm">{task.name}</p>
                <TaskStatusBadge
                  status={task.status as TaskStatus}
                  className="shrink-0"
                />
                <p className="text-muted-foreground shrink-0 text-xs sm:text-right">
                  <TimeAgo date={task.createdAt} locale={locale} />
                </p>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={labels.remove}
                disabled={isRemoving && pendingTaskId === task.id}
                onClick={() => setTaskToRemove(task)}
              >
                {isRemoving && pendingTaskId === task.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
              </Button>
            </li>
          ))}
        </ul>
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

      <AlertDialog
        open={taskToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setTaskToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.remove}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.confirmRemove}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={isRemoving}
              onClick={(event) => {
                event.preventDefault();
                handleRemoveTask();
              }}
            >
              {labels.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
