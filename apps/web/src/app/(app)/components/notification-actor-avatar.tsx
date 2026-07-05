"use client";

import { Bell } from "lucide-react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  CoworkerGrant,
  NotificationItem,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

interface NotificationActor {
  name: string;
  image: string | null;
}

function readStringParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The coworker a notification is about, when it is about one. Prefers the
 * grant's coworker row (covers COWORKER_ACCESS notifications created before
 * avatar params existed), then the coworkerName/coworkerImage/coworkerSlug
 * message params core embeds for coworker-driven notifications.
 *
 * A bare coworkerName without image/slug is NOT enough: placeholder names
 * ("A coworker", "Assistant") and rows whose message does not attribute an
 * actor must keep the bell rather than invent an avatar.
 */
export function getNotificationActor(
  notification: NotificationItem,
  grant?: CoworkerGrant | null,
): NotificationActor | null {
  if (grant?.coworker) {
    return {
      name: grant.coworker.name,
      image: getCoworkerImage(grant.coworker),
    };
  }
  const params = notification.messageParams as
    | Record<string, unknown>
    | null
    | undefined;
  const name = readStringParam(params, "coworkerName");
  const image = readStringParam(params, "coworkerImage");
  const slug = readStringParam(params, "coworkerSlug");
  if (!name || (!image && !slug)) return null;
  return {
    name,
    image: getCoworkerImage({ name, image, slug }),
  };
}

/**
 * Row icon for a notification: the coworker's avatar (image or initials)
 * when the notification is about a coworker, the bell otherwise.
 */
export function NotificationActorAvatar({
  notification,
  grant,
}: {
  notification: NotificationItem;
  grant?: CoworkerGrant | null;
}) {
  const actor = getNotificationActor(notification, grant);

  if (!actor) {
    return (
      <Bell
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notification.isRead ? "text-muted-foreground" : "text-primary",
        )}
      />
    );
  }

  return (
    <Avatar
      className={cn(
        "size-6 shrink-0",
        !notification.isRead && "ring-primary/40 ring-2",
      )}
    >
      {actor.image ? <AvatarImage src={actor.image} alt={actor.name} /> : null}
      <AvatarFallback className="bg-muted text-[10px]">
        {getInitials(actor.name)}
      </AvatarFallback>
    </Avatar>
  );
}
