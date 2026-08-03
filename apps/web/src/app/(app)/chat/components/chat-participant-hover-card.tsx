"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Children,
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";

import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

import { canShowOpenDirect } from "./open-direct-with-participant";
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
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirect?: (profile: ChatParticipantHoverProfile) => void;
  /** True while this participant's DM is being created/opened. */
  isOpeningDirect?: boolean;
  /** True while any hover-card DM open is in flight (disables Message). */
  isDirectActionBusy?: boolean;
}

interface TriggerChildProps {
  className?: string;
  style?: CSSProperties;
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

function renderHoverTrigger({
  profileName,
  children,
  className,
  style,
}: {
  profileName: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const childItems = Children.toArray(children).filter((child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child).trim().length > 0;
    }
    return true;
  });
  const singleChild =
    childItems.length === 1 && isValidElement<TriggerChildProps>(childItems[0])
      ? childItems[0]
      : null;

  if (singleChild) {
    return cloneElement(singleChild, {
      role: singleChild.props.role ?? "button",
      tabIndex: singleChild.props.tabIndex ?? 0,
      "aria-label": singleChild.props["aria-label"] ?? profileName,
      "aria-hidden": undefined,
      style: { ...singleChild.props.style, ...style },
      className: cn(
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
        singleChild.props.className,
        className,
      ),
    });
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={profileName}
      style={style}
      className={cn(
        "relative inline-flex w-fit max-w-full cursor-pointer self-start p-0 leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ChatParticipantHoverCard({
  profile,
  children,
  side = "top",
  align = "start",
  className,
  style,
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirect,
  isOpeningDirect = false,
  isDirectActionBusy = false,
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
  const showOpenDirect = canShowOpenDirect({
    profile,
    currentUserId,
    canOpenHumanDirect,
    onOpenDirect,
  });

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {renderHoverTrigger({
          profileName: profile.name,
          children,
          className,
          style,
        })}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-72 p-3"
        data-testid="chat-participant-hover-card"
      >
        <div className="flex gap-3">
          <div className="relative size-12 shrink-0 self-start">
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
          </div>
        </div>
        {showOpenDirect ? (
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={isOpeningDirect || isDirectActionBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenDirect?.(profile);
            }}
          >
            {isOpeningDirect ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <MessageCircle className="size-4" aria-hidden />
            )}
            {t("openDirectMessage")}
          </Button>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
