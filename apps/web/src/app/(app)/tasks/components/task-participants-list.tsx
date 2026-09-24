"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
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
import { removeTaskParticipant } from "@/lib/actions/task/action";
import type { TaskParticipant } from "@/lib/clients/generated/core/types.gen";

interface TaskParticipantsListProps {
  taskId: string;
  label: string;
  participants: TaskParticipant[];
  canRemove: boolean;
}

interface PendingRemove {
  userId: string;
  name: string;
}

export function TaskParticipantsList({
  taskId,
  label,
  participants,
  canRemove,
}: TaskParticipantsListProps) {
  const t = useTranslations("App.Tasks.Detail");
  const tApp = useTranslations("App");
  const [, startTransition] = useTransition();
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(
    null,
  );
  const [visibleParticipants, hideParticipant] = useOptimistic(
    participants,
    (current, userId: string) =>
      current.filter((participant) => participant.user.id !== userId),
  );

  function handleRemove(userId: string) {
    startTransition(async () => {
      hideParticipant(userId);
      const result = await removeTaskParticipant({ taskId, userId });
      if (!result.ok) {
        toast.error(t("removeParticipantError"));
      }
    });
  }

  if (visibleParticipants.length === 0) {
    return <span className="text-right text-sm font-medium">—</span>;
  }

  return (
    <>
      <ul
        aria-label={label}
        className="flex min-w-0 flex-col items-end gap-1.5"
      >
        {visibleParticipants.map(({ user }) => (
          <li key={user.id} className="flex min-w-0 items-center gap-2">
            <AssigneeAvatar assignee={{ ...user, kind: "user" }} />
            <span className="truncate text-sm font-medium">{user.name}</span>
            {canRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-6 shrink-0"
                aria-label={t("removeParticipant", { name: user.name })}
                onClick={() =>
                  setPendingRemove({ userId: user.id, name: user.name })
                }
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemove(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemove
                ? t("removeParticipantConfirmTitle", {
                    name: pendingRemove.name,
                  })
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeParticipantConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tApp("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemove) {
                  handleRemove(pendingRemove.userId);
                }
              }}
            >
              {pendingRemove
                ? t("removeParticipant", { name: pendingRemove.name })
                : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
