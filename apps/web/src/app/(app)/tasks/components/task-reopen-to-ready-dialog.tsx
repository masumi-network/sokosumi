"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface TaskReopenToReadyDialogLabels {
  title: string;
  description: string;
  commentLabel: string;
  commentPlaceholder: string;
  confirm: string;
  cancel: string;
}

interface TaskReopenToReadyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: TaskReopenToReadyDialogLabels;
  comment: string;
  onCommentChange: (comment: string) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

export function TaskReopenToReadyDialog({
  open,
  onOpenChange,
  labels,
  comment,
  onCommentChange,
  onConfirm,
  isPending = false,
}: TaskReopenToReadyDialogProps) {
  function handleOpenChange(nextOpen: boolean) {
    // Keep the dialog open while submit is in flight so Escape / outside-click
    // cannot clear pending board state while Core may still succeed.
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor="task-reopen-comment" className="text-sm font-medium">
            {labels.commentLabel}
          </label>
          <Textarea
            id="task-reopen-comment"
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder={labels.commentPlaceholder}
            rows={4}
            disabled={isPending}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={isPending || !comment.trim()}
            onClick={onConfirm}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
