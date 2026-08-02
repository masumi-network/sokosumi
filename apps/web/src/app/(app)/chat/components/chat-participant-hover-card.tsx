"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

import { AiCoworkerIcon } from "./room-draft-shared";
import {
  type ChatParticipantHoverProfile,
  presenceLabel,
} from "./room-helpers";

interface ChatParticipantHoverCardProps {
  profile: ChatParticipantHoverProfile | null | undefined;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  style?: CSSProperties;
}

export function ChatParticipantHoverCard({
  profile,
  children,
  side = "top",
  align = "start",
  className,
  style,
}: ChatParticipantHoverCardProps) {
  const t = useTranslations("App.Channels");

  if (!profile) {
    return children;
  }

  const statusLabel = presenceLabel(t, profile.presence);
  const kindLabel =
    profile.kind === "coworker" ? t("coworkerBadge") : t("humanBadge");
  const detail =
    profile.kind === "human"
      ? profile.email
      : profile.caption?.trim() || (profile.slug ? `@${profile.slug}` : null);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          style={style}
          className={cn(
            "relative inline-flex max-w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {children}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-72 p-3"
        data-testid="chat-participant-hover-card"
      >
        <div className="flex gap-3">
          <div className="relative shrink-0">
            <Avatar className="size-12">
              <AvatarImage src={profile.image ?? undefined} alt="" />
              <AvatarFallback
                className={cn(
                  "text-sm",
                  profile.kind === "coworker"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {getInitials(profile.name)}
              </AvatarFallback>
            </Avatar>
            <span aria-hidden="true">
              <PresenceDot
                presence={profile.presence}
                label={statusLabel}
                className="absolute -right-0.5 -bottom-0.5 size-3"
              />
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <p className="truncate text-sm font-semibold">{profile.name}</p>
              {profile.kind === "coworker" ? (
                <AiCoworkerIcon className="size-3.5 shrink-0" />
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs font-medium">
              {kindLabel}
            </p>
            {detail ? (
              <p className="text-muted-foreground truncate text-xs">{detail}</p>
            ) : null}
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span aria-hidden="true">
                <PresenceDot
                  presence={profile.presence}
                  label={statusLabel}
                  className="size-2 border-0"
                />
              </span>
              {statusLabel}
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
