"use client";

import { useTranslations } from "next-intl";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export function MembershipStatusRow({ message }: { message: ChatRoomMessage }) {
  const membership = message.membership;
  const t = useTranslations("App.Channels.MembershipStatus");

  if (membership == null) {
    return null;
  }

  const text =
    membership.action === "joined"
      ? t("joined", { name: membership.subject.name })
      : t("left", { name: membership.subject.name });

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-membership-status={membership.action}
      className="flex items-center justify-center py-2"
      role="status"
    >
      <p className="text-muted-foreground text-center text-xs">{text}</p>
    </div>
  );
}
