import { formatDistanceToNow } from "date-fns";
import { ArrowUp, Paperclip } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TaskEvent } from "@/lib/types/task";

interface ActorInfo {
  name: string;
  image: string | null;
}

interface TaskActivityProps {
  title: string;
  placeholder: string;
  attachLabel: string;
  submitLabel: string;
  events: TaskEvent[];
  userById?: Map<string, ActorInfo>;
  orchestratorById?: Map<string, ActorInfo>;
}

function getInitials(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return "?";
  }

  return trimmedName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TaskActivitySection({
  title,
  placeholder,
  attachLabel,
  submitLabel,
  events,
  userById,
  orchestratorById,
}: TaskActivityProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-primary text-lg font-semibold">{title}</h2>

      <div className="bg-muted/40 rounded-xl border p-3">
        <Textarea placeholder={placeholder} className="min-h-24 resize-none" />
        <div className="mt-2 flex items-center justify-end gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={attachLabel}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="primary"
            className="rounded-full"
            aria-label={submitLabel}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {events.map((event) => {
          const actorLabel = event.orchestratorId
            ? "Orchestrator"
            : event.userId
              ? "User"
              : "System";
          const actorInfo = event.orchestratorId
            ? orchestratorById?.get(event.orchestratorId)
            : event.userId
              ? userById?.get(event.userId)
              : undefined;
          const actorName = actorInfo?.name ?? actorLabel;
          const actorImage = actorInfo?.image ?? null;
          const action = event.comment ? "commented" : "updated status";

          return (
            <div
              key={event.id}
              className="bg-muted/30 flex items-start gap-3 rounded-lg px-3 py-2"
            >
              <Avatar className="size-9">
                {actorImage ? (
                  <AvatarImage src={actorImage} alt={actorName} />
                ) : null}
                <AvatarFallback>{getInitials(actorName)}</AvatarFallback>
              </Avatar>
              <div className="flex w-full flex-col gap-1">
                <div className="flex flex-row items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{actorName}</span>
                    <span className="text-muted-foreground">{action}</span>
                    {event.status && (
                      <span className="text-primary font-semibold">
                        {event.status}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(event.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {event.comment ? (
                  <p className="text-muted-foreground text-sm">
                    {event.comment}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
