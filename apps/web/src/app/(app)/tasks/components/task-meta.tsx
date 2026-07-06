"use client";

import { Calendar, MessageSquare, UserCog } from "lucide-react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import type { TaskWithCoworker } from "@/lib/types/task";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface TaskMetaDetailsProps {
  owner: TaskWithCoworker["user"];
  coworker: TaskWithCoworker["coworker"];
  /** Coworker that created the task via delegation (e.g. Hermes/Alex). */
  createdByCoworker?: TaskWithCoworker["createdByCoworker"];
  commentsCount: TaskWithCoworker["commentsCount"];
  createdAt: TaskWithCoworker["createdAt"];
  variant?: "card" | "list";
}

function CoworkerAvatar({
  coworker,
  size = "sm",
}: {
  coworker:
    | TaskWithCoworker["coworker"]
    | TaskWithCoworker["createdByCoworker"];
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
  owner,
  coworker,
  createdByCoworker,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  const { formatShortDate } = useLocalizedDateTime();
  const ownerName = owner.name.trim() || "—";
  const coworkerName = coworker?.name?.trim() || "—";
  // The creating coworker participates too, unless it is also the assignee.
  const creator =
    createdByCoworker && createdByCoworker.id !== coworker?.id
      ? createdByCoworker
      : null;
  const creatorName = creator?.name?.trim() || "—";
  const participantNames = [
    creator?.name?.trim(),
    coworker?.name?.trim(),
    ownerName,
  ]
    .filter(Boolean)
    .join(", ");

  if (variant === "list") {
    return (
      <>
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate text-xs">
          {creator ? (
            <span className="-mr-2.5 inline-flex" title={creatorName}>
              <CoworkerAvatar coworker={creator} />
            </span>
          ) : null}
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
        {creator ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="z-0 inline-flex">
                <CoworkerAvatar coworker={creator} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {creatorName}
            </TooltipContent>
          </Tooltip>
        ) : null}
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
              <UserProfileAvatar name={owner.name} image={owner.image} />
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
