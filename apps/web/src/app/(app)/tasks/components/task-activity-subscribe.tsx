"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  removeTaskParticipant,
  subscribeTaskParticipant,
} from "@/lib/actions/task/action";
import type { TaskParticipant } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

export interface TaskActivitySubscribeControlProps {
  taskId: string;
  viewerId: string | null;
  viewerName: string | null;
  viewerImage: string | null;
  participants: TaskParticipant[];
  /** Comment gate. Subscribe is hidden when false and the viewer is not a participant. */
  canComment: boolean;
}

export function TaskActivitySubscribeControl({
  taskId,
  viewerId,
  viewerName,
  viewerImage,
  participants,
  canComment,
}: TaskActivitySubscribeControlProps) {
  const t = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Committed state, not `useOptimistic`. An optimistic value is discarded
  // when the async transition ends and falls back to `participants` until
  // `router.refresh()` lands — so Subscribe briefly snaps back to Unsubscribe.
  const [visibleParticipants, setVisibleParticipants] = useState(participants);
  const [serverParticipants, setServerParticipants] = useState(participants);
  if (serverParticipants !== participants) {
    setServerParticipants(participants);
    setVisibleParticipants(participants);
  }

  const viewerIsParticipant =
    viewerId != null &&
    visibleParticipants.some((participant) => participant.user.id === viewerId);

  const showSubscribeLabel =
    viewerId != null && !viewerIsParticipant && canComment;
  const showUnsubscribeLabel = viewerId != null && viewerIsParticipant;

  if (
    !showSubscribeLabel &&
    !showUnsubscribeLabel &&
    visibleParticipants.length === 0
  ) {
    return null;
  }

  const faces = visibleParticipants.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = visibleParticipants.length - faces.length;

  function handleSubscribeToggle() {
    if (!viewerId) {
      return;
    }

    const previous = visibleParticipants;
    const next = viewerIsParticipant
      ? visibleParticipants.filter(
          (participant) => participant.user.id !== viewerId,
        )
      : [
          ...visibleParticipants,
          {
            user: {
              id: viewerId,
              name: viewerName ?? viewerId,
              image: viewerImage,
            },
            addedAt: new Date(),
          },
        ];
    setVisibleParticipants(next);

    startTransition(async () => {
      if (viewerIsParticipant) {
        const result = await removeTaskParticipant({
          taskId,
          userId: viewerId,
        });
        if (!result.ok) {
          setVisibleParticipants(previous);
          toast.error(t("removeParticipantError"));
          return;
        }
      } else {
        const result = await subscribeTaskParticipant({ taskId });
        if (!result.ok) {
          setVisibleParticipants(previous);
          toast.error(t("subscribeError"));
          return;
        }
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {showSubscribeLabel || showUnsubscribeLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-auto px-1.5 py-0.5 text-xs font-medium"
          disabled={isPending}
          onClick={handleSubscribeToggle}
        >
          {showUnsubscribeLabel ? t("unsubscribe") : t("subscribe")}
        </Button>
      ) : null}

      {visibleParticipants.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center rounded-full focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
              aria-label={t("participantsList")}
            >
              <span className="flex -space-x-1.5">
                {faces.map(({ user }, index) => (
                  <span
                    key={user.id}
                    data-testid={`task-subscribe-face-${user.id}`}
                    className={cn(
                      "ring-background relative inline-flex rounded-full ring-2",
                    )}
                    style={{ zIndex: faces.length - index }}
                  >
                    <AssigneeAvatar
                      assignee={{ ...user, kind: "user" }}
                      size="sm"
                    />
                  </span>
                ))}
                {remainingCount > 0 ? (
                  <span
                    data-testid="task-subscribe-face-remainder"
                    className="bg-muted text-muted-foreground ring-background relative inline-flex size-5 items-center justify-center rounded-full text-[0.625rem] font-medium tabular-nums ring-2"
                    style={{ zIndex: 0 }}
                    aria-hidden
                  >
                    +{remainingCount}
                  </span>
                ) : null}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {visibleParticipants.map(({ user }) => (
              <DropdownMenuItem
                key={user.id}
                className="flex items-center gap-2"
              >
                <AssigneeAvatar
                  assignee={{ ...user, kind: "user" }}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {user.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
