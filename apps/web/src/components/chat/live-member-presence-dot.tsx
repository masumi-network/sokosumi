"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

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
  /** Coworkers stay always-online (ADR-0003 v1). */
  isCoworker?: boolean;
  fallback?: ChatRoomPresence;
  className?: string;
  ground?: ComponentProps<typeof PresenceDot>["ground"];
}

/**
 * Roster presence dot overlaid with live org Ably Presence (ADR-0003).
 */
export function LiveMemberPresenceDot({
  userId,
  isCoworker = false,
  fallback = "offline",
  className,
  ground,
}: LiveMemberPresenceDotProps) {
  const t = useTranslations("App.Channels");
  const live = useMemberPresence(userId, fallback);
  const presence: ChatRoomPresence = isCoworker ? "online" : live;

  return (
    <PresenceDot
      className={className}
      ground={ground}
      presence={presence}
      title={presenceLabel(t, presence)}
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

interface LiveMemberPresenceTextProps {
  userId: string;
  isCoworker?: boolean;
  fallback?: ChatRoomPresence;
  /** Pass `sr-only` where the surface has no room for a visible label. */
  className?: string;
}

/**
 * Availability as text, live. `PresenceDot` is decorative on every surface, so
 * availability reaches assistive technology only through words: this, visible
 * copy, or a parent's own `aria-label` (which is how the sidebar account chip
 * does it). Render this outside any ancestor that overrides descendant text, or
 * an `aria-label` on a parent swallows it just the same.
 */
export function LiveMemberPresenceText({
  userId,
  isCoworker = false,
  fallback = "offline",
  className,
}: LiveMemberPresenceTextProps) {
  const t = useTranslations("App.Channels");
  const presence = useLiveMemberPresence(userId, { isCoworker, fallback });

  return <span className={className}>{presenceLabel(t, presence)}</span>;
}
