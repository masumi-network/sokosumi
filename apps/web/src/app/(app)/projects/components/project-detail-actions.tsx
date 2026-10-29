"use client";

import {
  CircleStop,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
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
import { closeProject } from "@/lib/actions/project/action";
import { cn } from "@/lib/utils";

import {
  type ProjectHideLabels,
  useProjectMenuActions,
} from "./use-project-menu-actions";

export interface ProjectDetailActionsLabels {
  moreActions: string;
  /** Omitted on a project card, which opens the project to edit it. */
  edit?: string;
  close: string;
  /** Only on a project card; the header has its own Pin button. */
  pin?: { pin: string; unpin: string; error: string };
  hide: ProjectHideLabels;
  closeDialog: {
    title: string;
    description: string;
    scheduledPostsWarning?: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    confirm: string;
    cancel: string;
    success: string;
    error: string;
  };
}

interface ProjectDetailActionsProps {
  projectId: string;
  projectRevision?: number;
  isClosingOrClosed?: boolean;
  /** The reader's own Hide; Hidden or not, the project stays reachable here. */
  isHidden?: boolean;
  /** The reader's own Pin, for the Pin or Unpin item. */
  isPinned?: boolean;
  labels: ProjectDetailActionsLabels;
  /** Restyles the "More actions" button, as the project card does. */
  triggerClassName?: string;
}

/**
 * The project's menu: Edit (header only), Pin or Unpin (card only), Hide or
 * Show, and Close behind a confirmation. Shared by the project header and the
 * Projects list card.
 */
export function ProjectDetailActions({
  projectId,
  projectRevision,
  isClosingOrClosed = false,
  isHidden = false,
  isPinned = false,
  labels,
  triggerClassName,
}: ProjectDetailActionsProps) {
  const router = useRouter();
  // Both callers read the Pin and Hide on the server, so a refresh redraws
  // the menu and re-sorts or moves a card on the Projects list.
  const projectActions = useProjectMenuActions({
    labels: labels.hide,
    pinError: labels.pin?.error,
    onChange: () => router.refresh(),
  });
  // Hiding unpins, so a Hidden project offers no Pin; a closing one keeps
  // only Unpin, as the header's Pin button does.
  const pinItem =
    labels.pin && !isHidden && (isPinned || !isClosingOrClosed)
      ? labels.pin
      : null;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeAttemptRef = useRef<{
    operationId: string;
    reason?: string;
  } | null>(null);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [isClosing, startCloseTransition] = useTransition();

  useEffect(() => {
    if (!isClosingOrClosed) {
      return;
    }
    closeAttemptRef.current = null;
    setCloseReason("");
    setIsCloseDialogOpen(false);
  }, [isClosingOrClosed]);

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
            className={cn("size-10 md:size-8", triggerClassName)}
            aria-label={labels.moreActions}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {labels.edit ? (
            <DropdownMenuItem asChild>
              <Link href={`/projects/${projectId}/edit`}>
                <Pencil className="size-4" aria-hidden />
                {labels.edit}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {pinItem ? (
            <DropdownMenuItem
              disabled={projectActions.isPending}
              onSelect={() => projectActions.setPinned(projectId, !isPinned)}
            >
              {isPinned ? (
                <PinOff className="size-4" aria-hidden />
              ) : (
                <Pin className="size-4" aria-hidden />
              )}
              {isPinned ? pinItem.unpin : pinItem.pin}
            </DropdownMenuItem>
          ) : null}
          {isHidden ? (
            <DropdownMenuItem
              disabled={projectActions.isPending}
              onSelect={() => projectActions.show(projectId)}
            >
              <Eye className="size-4" aria-hidden />
              {labels.hide.show}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={projectActions.isPending}
              onSelect={() => projectActions.hide(projectId)}
            >
              <EyeOff className="size-4" aria-hidden />
              {labels.hide.hide}
            </DropdownMenuItem>
          )}
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
          {labels.closeDialog.scheduledPostsWarning ? (
            <p role="status" className="text-semantic-warning text-sm">
              {labels.closeDialog.scheduledPostsWarning}
            </p>
          ) : null}
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
              loading={isClosing}
              onClick={(event) => {
                event.preventDefault();
                handleCloseProject();
              }}
            >
              {labels.closeDialog.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
