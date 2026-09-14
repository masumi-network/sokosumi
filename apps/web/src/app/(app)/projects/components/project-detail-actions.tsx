"use client";

import {
  CircleStop,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeProject, deleteProject } from "@/lib/actions/project/action";

interface ProjectDetailActionsLabels {
  moreActions: string;
  edit: string;
  close: string;
  delete: string;
  closeDialog: {
    title: string;
    description: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    confirm: string;
    cancel: string;
    success: string;
    error: string;
  };
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
  projectRevision?: number;
  isClosingOrClosed?: boolean;
  labels: ProjectDetailActionsLabels;
}

export function ProjectDetailActions({
  projectId,
  projectRevision,
  isClosingOrClosed = false,
  labels,
}: ProjectDetailActionsProps) {
  const router = useRouter();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeAttemptRef = useRef<{
    operationId: string;
    reason?: string;
  } | null>(null);
  const deleteAttemptRef = useRef<string | null>(null);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [isClosing, startCloseTransition] = useTransition();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  useEffect(() => {
    if (!isClosingOrClosed) {
      return;
    }
    closeAttemptRef.current = null;
    setCloseReason("");
    setIsCloseDialogOpen(false);
    setIsDeleteDialogOpen(false);
  }, [isClosingOrClosed]);

  function handleDeleteProject() {
    const operationId = deleteAttemptRef.current ?? crypto.randomUUID();
    deleteAttemptRef.current = operationId;
    startDeleteTransition(async () => {
      try {
        await deleteProject({ projectId, operationId });
        deleteAttemptRef.current = null;
        setIsDeleteDialogOpen(false);
        router.replace("/projects");
        router.refresh();
      } catch {
        toast.error(labels.deleteDialog.error, { duration: Infinity });
      }
    });
  }

  function handleCloseProject() {
    if (projectRevision === undefined) {
      return;
    }

    const normalizedReason = closeReason.trim() || undefined;
    let closeAttempt = closeAttemptRef.current;
    if (!closeAttempt || closeAttempt.reason !== normalizedReason) {
      closeAttempt = {
        operationId: crypto.randomUUID(),
        reason: normalizedReason,
      };
    }
    closeAttemptRef.current = closeAttempt;

    startCloseTransition(async () => {
      try {
        await closeProject({
          projectId,
          operationId: closeAttempt.operationId,
          expectedProjectRevision: projectRevision,
          ...(normalizedReason ? { reason: normalizedReason } : {}),
        });
        closeAttemptRef.current = null;
        setIsCloseDialogOpen(false);
        setCloseReason("");
        toast.success(labels.closeDialog.success);
        router.refresh();
      } catch {
        router.refresh();
        toast.error(labels.closeDialog.error, { duration: Infinity });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTriggerRef}
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
          {!isClosingOrClosed && projectRevision !== undefined ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setIsCloseDialogOpen(true);
              }}
            >
              <CircleStop className="size-4" aria-hidden />
              {labels.close}
            </DropdownMenuItem>
          ) : null}
          {!isClosingOrClosed ? (
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
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={isCloseDialogOpen && !isClosingOrClosed}
        onOpenChange={(open) => {
          if (open || !isClosing) {
            setIsCloseDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTriggerRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.closeDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.closeDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`project-close-reason-${projectId}`}>
              {labels.closeDialog.reasonLabel}
            </Label>
            <Textarea
              id={`project-close-reason-${projectId}`}
              name="projectCloseReason"
              value={closeReason}
              onChange={(event) => setCloseReason(event.target.value)}
              placeholder={labels.closeDialog.reasonPlaceholder}
              disabled={isClosing}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClosing}>
              {labels.closeDialog.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
              disabled={isClosing}
              onClick={(event) => {
                event.preventDefault();
                handleCloseProject();
              }}
            >
              {isClosing ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {labels.closeDialog.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteDialogOpen && !isClosingOrClosed}
        onOpenChange={(open) => {
          if (open || !isDeleting) {
            setIsDeleteDialogOpen(open);
            if (!open) {
              deleteAttemptRef.current = null;
            }
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTriggerRef.current?.focus();
          }}
        >
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
              className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
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
    </>
  );
}
