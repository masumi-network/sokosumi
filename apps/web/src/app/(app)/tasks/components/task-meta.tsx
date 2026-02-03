import { MessageSquare, UserCog } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { type TaskWithOrchestrator } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";

interface TaskMetaDetailsProps {
  orchestrator: TaskWithOrchestrator["orchestrator"];
  commentsCount: TaskWithOrchestrator["commentsCount"];
  createdAt: TaskWithOrchestrator["createdAt"];
  variant?: "card" | "list";
}

function OrchestratorAvatar({
  orchestrator,
}: {
  orchestrator: TaskWithOrchestrator["orchestrator"];
}) {
  const image = orchestrator?.image
    ? ipfsUrlResolver(orchestrator.image)
    : null;

  return (
    <Avatar className="size-4 shrink-0">
      {image ? (
        <AvatarImage
          src={image}
          alt={orchestrator?.name ?? "Orchestrator"}
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
  orchestrator,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  if (variant === "list") {
    return (
      <>
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate">
          <OrchestratorAvatar orchestrator={orchestrator} />
          <span className="truncate">{orchestrator?.name ?? "—"}</span>
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
        <OrchestratorAvatar orchestrator={orchestrator} />
        <span>{orchestrator?.name ?? "—"}</span>
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
