"use client";

import type { TaskParticipant } from "@sokosumi/core-client";
import { LogIn, LogOut, UsersRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  removeTaskParticipant,
  subscribeTaskParticipant,
} from "@/lib/actions/task/action";
import { cn } from "@/lib/utils";
import { ROW_TRIGGER_CLASS } from "./task-status-picker";

export interface TaskParticipantsFieldLabels {
  participants: string;
  noParticipants: string;
  joinTask: string;
  leaveTask: string;
  joinError: string;
  leaveError: string;
}

/**
 * The Participants property, editable: a click lists who takes part and
 * lets the viewer join or leave. Following with a Soko Bot is separate.
 */
export function TaskMetadataParticipantsField({
  taskId,
  viewer,
  participants,
  canJoin,
  labels,
}: {
  taskId: string;
  viewer: { id: string; name: string; image: string | null };
  participants: TaskParticipant[];
  /** Comment gate. Joining needs it; leaving never does. */
  canJoin: boolean;
  labels: TaskParticipantsFieldLabels;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Committed state, not `useOptimistic`: an optimistic value snaps back
  // when the transition ends, before the action's own render lands.
  const [visible, setVisible] = useState(participants);
  const [server, setServer] = useState(participants);
  if (server !== participants && !isPending) {
    setServer(participants);
    setVisible(participants);
  }

  const joined = visible.some(({ user }) => user.id === viewer.id);
  const faces = visible.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = visible.length - faces.length;
  const value =
    visible.length > 0
      ? visible.map(({ user }) => user.name).join(", ")
      : labels.noParticipants;

  function toggle() {
    setOpen(false);
    const previous = visible;
    setVisible(
      joined
        ? visible.filter(({ user }) => user.id !== viewer.id)
        : [...visible, { user: viewer, addedAt: new Date() }],
    );
    startTransition(async () => {
      const result = joined
        ? await removeTaskParticipant({ taskId })
        : await subscribeTaskParticipant({ taskId });
      if (!result.ok) {
        setVisible(previous);
        toast.error(joined ? labels.leaveError : labels.joinError);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${labels.participants}: ${value}`}
          className={cn(
            "focus-visible:ring-ring outline-hidden focus-visible:ring-2",
            ROW_TRIGGER_CLASS,
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            {faces[0] ? (
              <AssigneeAvatar
                assignee={{ ...faces[0].user, kind: "user" }}
                size="sm"
              />
            ) : (
              <UsersRound className="text-muted-foreground size-4" />
            )}
          </span>
          {visible.length === 0 ? (
            <span className="text-muted-foreground truncate">
              {labels.noParticipants}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              {faces.slice(1).map(({ user }) => (
                <AssigneeAvatar
                  key={user.id}
                  assignee={{ ...user, kind: "user" }}
                  size="sm"
                />
              ))}
              {remainingCount > 0 ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  +{remainingCount}
                </span>
              ) : null}
              {faces.length === 1 ? (
                <span className="truncate">{faces[0].user.name}</span>
              ) : null}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        aria-label={labels.participants}
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-sm">
            {labels.noParticipants}
          </p>
        ) : (
          <ul aria-label={labels.participants}>
            {visible.map(({ user }) => (
              <li
                key={user.id}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
              >
                {/* The name beside it says who: the face is read once. */}
                <span aria-hidden className="inline-flex">
                  <AssigneeAvatar
                    assignee={{ ...user, kind: "user" }}
                    size="sm"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">{user.name}</span>
              </li>
            ))}
          </ul>
        )}
        {joined || canJoin ? (
          <button
            type="button"
            disabled={isPending}
            onClick={toggle}
            className={cn(
              "hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm disabled:opacity-50",
              "mt-1 border-t",
            )}
          >
            {joined ? (
              <LogOut className="text-muted-foreground size-4" aria-hidden />
            ) : (
              <LogIn className="text-muted-foreground size-4" aria-hidden />
            )}
            {joined ? labels.leaveTask : labels.joinTask}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
