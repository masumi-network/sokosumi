"use client";

import { Pencil, Trash } from "lucide-react";
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
import { deleteTask } from "@/lib/actions/task/action";

interface TaskDetailActionsLabels {
  edit: string;
  delete: string;
  confirmDelete: string;
  confirmDeleteDescription: string;
  deleteError: string;
}

interface TaskDetailActionsProps {
  taskId: string;
  labels: TaskDetailActionsLabels;
}

export function TaskDetailActions({ taskId, labels }: TaskDetailActionsProps) {
  const t = useTranslations("App");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  const handleDelete = () => {
    startTransition(async () => {
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
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link href={`/tasks/${taskId}/edit`}>
          <Pencil className="size-4" aria-hidden />
          <span>{labels.edit}</span>
        </Link>
      </Button>
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            disabled={isPending}
          >
            <Trash className="size-4" aria-hidden />
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
            <AlertDialogCancel disabled={isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
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
