"use client";

import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { AssistantOrb } from "@/components/aurora-orb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { defaultOrbSeed } from "@/lib/aurora-orb";

export function AssigneeAvatar({
  assignee,
  size = "sm",
}: {
  assignee: TaskAssigneeView | null | undefined;
  size?: "sm" | "md";
}) {
  const image = getCoworkerImage(assignee);
  const sizeClass = size === "sm" ? "size-5" : "size-6";
  const orbSize = size === "sm" ? 20 : 24;

  if (
    assignee?.kind === "sokoBot" &&
    !image &&
    (assignee.avatarSeed || assignee.id)
  ) {
    return (
      <AssistantOrb
        seed={assignee.avatarSeed ?? defaultOrbSeed(assignee.id)}
        expression="idle"
        animate={false}
        size={orbSize}
        className={`${sizeClass} shrink-0`}
        alt={assignee.name}
      />
    );
  }

  if (assignee == null) {
    return (
      <Avatar className={`${sizeClass} shrink-0`}>
        <AvatarFallback className="bg-muted text-[0.625rem] font-medium">
          ?
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar className={`${sizeClass} shrink-0`}>
      {image ? (
        <AvatarImage
          src={image}
          alt={assignee.name ?? "Coworker"}
          className="object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[0.625rem] font-medium">
        {assignee.name?.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
