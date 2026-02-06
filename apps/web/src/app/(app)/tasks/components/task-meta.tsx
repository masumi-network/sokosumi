import { MessageSquare, UserCog } from "lucide-react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { type TaskWithCoworker } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";

interface TaskMetaDetailsProps {
  coworker: TaskWithCoworker["coworker"];
  commentsCount: TaskWithCoworker["commentsCount"];
  createdAt: TaskWithCoworker["createdAt"];
  variant?: "card" | "list";
}

function CoworkerAvatar({
  coworker,
  size = "sm",
}: {
  coworker: TaskWithCoworker["coworker"];
  size?: "sm" | "md";
}) {
  const image = getCoworkerImage(coworker);
  const sizeClass = size === "sm" ? "size-5" : "size-6";

  return (
    <Avatar className={`${sizeClass} ring-background shrink-0 ring-2`}>
      {image ? (
        <AvatarImage
          src={image}
          alt={coworker?.name ?? "Coworker"}
          className="object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[10px] font-medium">
        {coworker?.name?.slice(0, 1).toUpperCase() ?? (
          <UserCog className="size-3" aria-hidden />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskMetaDetails({
  coworker,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  if (variant === "list") {
    return (
      <>
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate text-xs">
          <CoworkerAvatar coworker={coworker} />
          <span className="truncate">{coworker?.name ?? "—"}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <MessageSquare className="size-3.5" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="text-muted-foreground text-xs">
          <span className="whitespace-nowrap">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="border-border/50 flex items-center justify-between gap-2 border-t pt-1">
      <div className="flex items-center gap-1.5">
        <CoworkerAvatar coworker={coworker} />
        <span className="text-muted-foreground max-w-[80px] truncate text-xs">
          {coworker?.name ?? "—"}
        </span>
      </div>
      <div className="text-muted-foreground/60 flex items-center gap-2">
        {commentsCount > 0 && (
          <div className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            <span className="text-[10px] tabular-nums">{commentsCount}</span>
          </div>
        )}
        <span className="text-[10px] tabular-nums">
          {formatShortDate(createdAt)}
        </span>
      </div>
    </div>
  );
}
