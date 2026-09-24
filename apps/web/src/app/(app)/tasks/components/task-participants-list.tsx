"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { removeTaskParticipant } from "@/lib/actions/task/action";
import type { TaskParticipant } from "@/lib/clients/generated/core/types.gen";

interface TaskParticipantsListProps {
  taskId: string;
  label: string;
  participants: TaskParticipant[];
  canRemove: boolean;
}

export function TaskParticipantsList({
  taskId,
  label,
  participants,
  canRemove,
}: TaskParticipantsListProps) {
  const t = useTranslations("App.Tasks.Detail");
  const [, startTransition] = useTransition();
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
    <ul aria-label={label} className="flex min-w-0 flex-col items-end gap-1.5">
      {visibleParticipants.map(({ user }) => (
        <li key={user.id} className="flex min-w-0 items-center gap-2">
          <Avatar className="size-5">
            {user.image ? (
              <AvatarImage
                src={resolveIpfsOrHttpUrl(user.image)}
                alt=""
                className="object-cover"
              />
            ) : null}
            <AvatarFallback className="bg-muted text-[0.625rem]">
              {user.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-medium">{user.name}</span>
          {canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-6 shrink-0"
              aria-label={t("removeParticipant", { name: user.name })}
              onClick={() => handleRemove(user.id)}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
