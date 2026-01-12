import { formatDistanceToNow } from "date-fns";
import { ArrowUp, Paperclip } from "lucide-react";

import { TaskActivity } from "@/app/tasks/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface TaskActivityProps {
  title: string;
  placeholder: string;
  attachLabel: string;
  submitLabel: string;
  activities: TaskActivity[];
}

function getInitials(name: string) {
  return name
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
  activities,
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
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="bg-muted/30 flex items-center gap-3 rounded-lg px-3 py-2"
          >
            <Avatar className="size-9">
              <AvatarImage src={activity.actorImage} alt={activity.actorName} />
              <AvatarFallback>{getInitials(activity.actorName)}</AvatarFallback>
            </Avatar>
            <div className="flex w-full flex-row items-center justify-between space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{activity.actorName}</span>
                <span className="text-muted-foreground">{activity.action}</span>
                {activity.status && (
                  <span className="text-primary font-semibold">
                    {activity.status}
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-xs">
                {formatDistanceToNow(new Date(activity.timestamp), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
