"use client";

import { useTranslations } from "next-intl";
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

interface TaskReopenToReadyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Coworker or Soko Bot that picks the Task up again. */
  assigneeName: string;
  comment: string;
  onCommentChange: (comment: string) => void;
  /** Sends the Task back to Ready with the comment as instructions. */
  onConfirm: () => void;
  /** Reopens without a run. Absent where only Ready makes sense. */
  onReopenAsDraft?: () => void;
  isPending?: boolean;
}

/**
 * A Coworker or Soko Bot starts a new run when its Task goes back to Ready,
 * so the person says what to fix, or parks it as a Draft instead.
 */
export function TaskReopenToReadyDialog({
  open,
  onOpenChange,
  assigneeName,
  comment,
  onCommentChange,
  onConfirm,
  onReopenAsDraft,
  isPending = false,
}: TaskReopenToReadyDialogProps) {
  const t = useTranslations("App.Tasks.Detail.actions.sendBack");
  const values = { assignee: assigneeName };

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
          <DialogTitle>{t("title", values)}</DialogTitle>
          <DialogDescription>{t("description", values)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor="task-reopen-comment" className="text-sm font-medium">
            {t("commentLabel")}
          </label>
          <Textarea
            id="task-reopen-comment"
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder={t("commentPlaceholder", values)}
            rows={4}
            disabled={isPending}
          />
        </div>
        <DialogFooter>
          {onReopenAsDraft ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onReopenAsDraft}
            >
              {t("reopenAsDraft")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              {t("cancel")}
            </Button>
          )}
          <Button
            type="button"
            disabled={!comment.trim()}
            loading={isPending}
            onClick={onConfirm}
          >
            {t("confirm", values)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
