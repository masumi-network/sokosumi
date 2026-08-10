"use client";

import { useTranslations } from "next-intl";

import { PresenceDot } from "@/components/chat/presence-dot";
import { useMemberPresence } from "@/contexts/org-presence-provider";
import type { ChatRoomPresence } from "@/lib/clients/generated/core";

function presenceLabel(
  t: ReturnType<typeof useTranslations<"App.Channels">>,
  presence: ChatRoomPresence,
) {
  if (presence === "online") {
    return t("Presence.online");
  }
  if (presence === "afk") {
    return t("Presence.afk");
  }
  return t("Presence.offline");
}

interface LiveMemberPresenceDotProps {
  userId: string;
  /** Coworkers stay always-online (ADR-0002 v1). */
  isCoworker?: boolean;
  fallback?: ChatRoomPresence;
  className?: string;
}

/**
 * Roster presence dot overlaid with live org Ably Presence (ADR-0002).
 */
export function LiveMemberPresenceDot({
  userId,
  isCoworker = false,
  fallback = "offline",
  className,
}: LiveMemberPresenceDotProps) {
  const t = useTranslations("App.Channels");
  const live = useMemberPresence(userId, fallback);
  const presence: ChatRoomPresence = isCoworker ? "online" : live;

  return (
    <PresenceDot
      className={className}
      label={presenceLabel(t, presence)}
      presence={presence}
    />
  );
}

/**
 * Resolve live presence for labels (hover card, aria) without mounting a dot.
 */
export function useLiveMemberPresence(
  userId: string,
  options?: {
    isCoworker?: boolean;
    fallback?: ChatRoomPresence;
  },
): ChatRoomPresence {
  const live = useMemberPresence(userId, options?.fallback ?? "offline");
  if (options?.isCoworker) {
    return "online";
  }
  return live;
}
