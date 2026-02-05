import { MessageSquare, UserCog } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ipfsUrlResolver } from "@/lib/ipfs";
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
}: {
  coworker: TaskWithCoworker["coworker"];
}) {
  const image = coworker?.image
    ? ipfsUrlResolver(coworker.image)
    : null;

  return (
    <Avatar className="size-4 shrink-0">
      {image ? (
        <AvatarImage
          src={image}
          alt={coworker?.name ?? "Coworker"}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-transparent">
        <UserCog className="size-4" aria-hidden />
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
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate">
          <CoworkerAvatar coworker={coworker} />
          <span className="truncate">{coworker?.name ?? "—"}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="size-4" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5">
          <span className="whitespace-nowrap">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        <CoworkerAvatar coworker={coworker} />
        <span>{coworker?.name ?? "—"}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="size-4" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>{formatShortDate(createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
