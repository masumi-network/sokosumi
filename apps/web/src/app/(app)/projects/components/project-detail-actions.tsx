"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteProject } from "@/lib/actions/project/action";

interface ProjectDetailActionsLabels {
  moreActions: string;
  edit: string;
  delete: string;
  deleteDialog: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
    error: string;
  };
}

interface ProjectDetailActionsProps {
  projectId: string;
  labels: ProjectDetailActionsLabels;
}

export function ProjectDetailActions({
  projectId,
  labels,
}: ProjectDetailActionsProps) {
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteProject() {
    startDeleteTransition(async () => {
      try {
        await deleteProject({ projectId });
        setIsDeleteDialogOpen(false);
        router.replace("/projects");
        router.refresh();
      } catch {
        toast.error(labels.deleteDialog.error);
      }
    });
  }

  return (
    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={labels.moreActions}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/projects/${projectId}/edit`}>
              <Pencil className="size-4" aria-hidden />
              {labels.edit}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setIsDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {labels.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.deleteDialog.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {labels.deleteDialog.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {labels.deleteDialog.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              handleDeleteProject();
            }}
          >
            {labels.deleteDialog.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
