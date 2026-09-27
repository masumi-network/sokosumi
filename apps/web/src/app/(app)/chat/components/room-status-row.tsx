"use client";

import { useTranslations } from "next-intl";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/** A room's own timeline note: someone joined or left, or the group was named. */
export function RoomStatusRow({ message }: { message: ChatRoomMessage }) {
  const { membership, groupNameChange } = message;
  const t = useTranslations("App.Channels");

  let text: string;
  if (membership != null) {
    text =
      membership.action === "joined"
        ? t("MembershipStatus.joined", { name: membership.subject.name })
        : t("MembershipStatus.left", { name: membership.subject.name });
  } else if (groupNameChange != null) {
    text =
      groupNameChange.action === "named"
        ? t("GroupName.named", {
            name: groupNameChange.actor.name,
            groupName: groupNameChange.name ?? "",
          })
        : t("GroupName.cleared", { name: groupNameChange.actor.name });
  } else {
    return null;
  }

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-membership-status={membership?.action}
      // relative isolate: a jump can land here too, and the highlight in
      // globals.css paints on ::before/::after at z-index -1.
      className="relative isolate flex items-center justify-center py-2"
      role="status"
    >
      <p className="text-muted-foreground text-center text-xs">{text}</p>
    </div>
  );
}
