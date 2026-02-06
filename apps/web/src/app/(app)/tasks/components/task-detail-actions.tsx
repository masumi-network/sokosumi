"use client";

import { TaskStatus } from "@sokosumi/database";
import { Loader2, Pencil, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteTask, setTaskStatusFromDrag } from "@/lib/actions/task/action";

interface TaskDetailActionsLabels {
  edit: string;
  delete: string;
  confirmDelete: string;
  confirmDeleteDescription: string;
  deleteError: string;
  markAsReady: string;
  revertToDraft: string;
}

interface TaskDetailActionsProps {
  taskId: string;
  status: TaskStatus;
  labels: TaskDetailActionsLabels;
}

export function TaskDetailActions({
  taskId,
  status,
  labels,
}: TaskDetailActionsProps) {
  const t = useTranslations("App");
  const router = useRouter();
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  const statusActionLabel =
    status === TaskStatus.DRAFT ? labels.markAsReady : labels.revertToDraft;
  const statusActionTarget =
    status === TaskStatus.DRAFT ? TaskStatus.READY : TaskStatus.DRAFT;

  const handleStatusToggle = () => {
    startStatusTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId,
          desiredStatus: statusActionTarget,
        });
        router.refresh();
        toast.success(t("Tasks.Detail.actions.updateStatusSuccess"));
      } catch (error) {
        console.error("Failed to update task status", error);
        toast.error(t("Tasks.Errors.updateStatus"));
      }
    });
  };

  const handleDelete = () => {
    startDeleteTransition(async () => {
      try {
        await deleteTask({ taskId });
        setIsOpen(false);
        router.push("/tasks");
      } catch (error) {
        console.error("Failed to delete task", error);
        toast.error(labels.deleteError);
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={handleStatusToggle}
        disabled={isStatusPending}
        className="h-7 gap-1.5 px-2.5 text-xs"
      >
        {isStatusPending ? <Loader2 className="size-3 animate-spin" /> : null}
        <span>{statusActionLabel}</span>
      </Button>
      <Link
        href={`/tasks/${taskId}/edit`}
        aria-disabled={isStatusPending}
        tabIndex={isStatusPending ? -1 : 0}
        className={`inline-flex items-center ${isStatusPending ? "pointer-events-none opacity-70" : ""}`}
      >
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={isStatusPending}
          tabIndex={-1}
        >
          <span className="flex items-center gap-1">
            <Pencil className="size-3" aria-hidden />
            <span>{labels.edit}</span>
          </span>
        </Button>
      </Link>
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-xs"
            disabled={isDeletePending || isStatusPending}
          >
            <Trash className="size-3" aria-hidden />
            <span>{labels.delete}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.confirmDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {labels.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
