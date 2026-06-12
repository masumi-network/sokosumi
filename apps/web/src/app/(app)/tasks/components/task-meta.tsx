"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Calendar, MessageSquare, User, UserCog } from "lucide-react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TaskWithCoworker } from "@/lib/types/task";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface TaskMetaDetailsProps {
  owner: TaskWithCoworker["user"];
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

function OwnerAvatar({
  owner,
  size = "sm",
}: {
  owner: TaskWithCoworker["user"];
  size?: "sm" | "md";
}) {
  const image = owner.image ? resolveIpfsOrHttpUrl(owner.image) : null;
  const sizeClass = size === "sm" ? "size-5" : "size-6";
  const ownerName = owner.name.trim();

  return (
    <Avatar className={`${sizeClass} ring-background shrink-0 ring-2`}>
      {image ? (
        <AvatarImage
          src={image}
          alt={ownerName || "User"}
          className="object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[10px] font-medium">
        {ownerName.slice(0, 1).toUpperCase() || (
          <User className="size-3" aria-hidden />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskMetaDetails({
  owner,
  coworker,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  const { formatShortDate } = useLocalizedDateTime();
  const ownerName = owner.name.trim() || "—";
  const coworkerName = coworker?.name?.trim() || "—";
  const participantNames = coworker?.name?.trim()
    ? `${coworkerName}, ${ownerName}`
    : ownerName;

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
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Calendar className="size-3" aria-hidden />
          <span className="whitespace-nowrap">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="border-border flex items-center justify-between gap-2 border-t pt-2">
      <div
        className="flex items-center -space-x-1"
        aria-label={participantNames}
        role="img"
      >
        {coworker ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="z-10 inline-flex">
                <CoworkerAvatar coworker={coworker} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {coworkerName}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="z-20 inline-flex">
              <OwnerAvatar owner={owner} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {ownerName}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="text-muted-foreground/60 flex items-center gap-2">
        {commentsCount > 0 && (
          <div className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            <span className="text-[10px] tabular-nums">{commentsCount}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="size-3" aria-hidden />
          <span className="text-[10px] tabular-nums">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
