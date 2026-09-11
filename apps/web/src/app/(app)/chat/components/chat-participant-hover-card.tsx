"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Children,
  type CSSProperties,
  cloneElement,
  isValidElement,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useRef,
} from "react";

import { AuroraOrb } from "@/components/aurora-orb";
import {
  LiveMemberPresenceDot,
  LiveMemberPresenceText,
} from "@/components/chat/live-member-presence-dot";
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
import { type ChatParticipantHoverProfile } from "./room-helpers";

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
  /**
   * When false, the trigger is not a keyboard button (use when nested inside
   * a link/row that already owns activation). Still hoverable.
   */
  interactive?: boolean;
  /**
   * When false, only the trigger renders (same element, same focus
   * semantics) and no hover-card root or content is mounted. Transcript rows
   * pass this so a row that was never hovered or focused skips two Radix
   * roots. Defaults to true.
   */
  active?: boolean;
  openDelay?: number;
  closeDelay?: number;
}

type FocusHandler = (event: ReactFocusEvent<HTMLElement>) => void;

/** Ref and focus handlers the card attaches to whichever trigger it renders. */
interface TriggerFocusProps {
  ref?: Ref<HTMLElement>;
  onFocus?: FocusHandler;
  onBlur?: FocusHandler;
}

interface TriggerChildProps extends TriggerFocusProps {
  className?: string;
  style?: CSSProperties;
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

function composeFocusHandlers(
  childHandler: FocusHandler | undefined,
  ownHandler: FocusHandler | undefined,
): FocusHandler | undefined {
  if (!childHandler || !ownHandler) {
    return childHandler ?? ownHandler;
  }
  return (event) => {
    childHandler(event);
    ownHandler(event);
  };
}

function renderHoverTrigger({
  profileName,
  children,
  className,
  style,
  interactive,
  focusProps = {},
}: {
  profileName: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  interactive: boolean;
  focusProps?: TriggerFocusProps;
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
      ...(interactive
        ? {
            role: singleChild.props.role ?? "button",
            tabIndex: singleChild.props.tabIndex ?? 0,
            // Named for keyboard focus; skip when nested in a link (row owns name).
            "aria-label": singleChild.props["aria-label"] ?? profileName,
          }
        : {
            // Strip focus semantics if the child brought them (e.g. nested in a link).
            role: undefined,
            tabIndex: undefined,
            // Drop any child label so SRs don't double-speak the row link name.
            "aria-label": undefined,
          }),
      "aria-hidden": undefined,
      style: { ...singleChild.props.style, ...style },
      className: cn(
        "cursor-pointer outline-none",
        interactive && "focus-visible:ring-2 focus-visible:ring-ring",
        singleChild.props.className,
        className,
      ),
      ref: focusProps.ref,
      onFocus: composeFocusHandlers(
        singleChild.props.onFocus,
        focusProps.onFocus,
      ),
      onBlur: composeFocusHandlers(singleChild.props.onBlur, focusProps.onBlur),
    });
  }

  if (!interactive) {
    return (
      <span
        {...focusProps}
        style={style}
        className={cn(
          "relative inline-flex w-fit max-w-full cursor-pointer self-start p-0 leading-none",
          className,
        )}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      {...focusProps}
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
  interactive = true,
  active = true,
  openDelay = 200,
  closeDelay = 100,
}: ChatParticipantHoverCardProps) {
  const t = useTranslations("App.Channels");
  // Activation swaps the bare trigger for the Radix one, which remounts the
  // element and drops focus. When keyboard focus was on the bare trigger at
  // that moment, the Radix trigger takes focus as soon as it attaches, so
  // the card opens on focus exactly as it does for an always-active card.
  const bareTriggerFocused = useRef(false);
  const focusOnAttach = useCallback((node: HTMLElement | null) => {
    if (node && bareTriggerFocused.current) {
      bareTriggerFocused.current = false;
      node.focus();
    }
  }, []);

  if (!profile) {
    return children;
  }

  if (!active) {
    return renderHoverTrigger({
      profileName: profile.name,
      children,
      className,
      style,
      interactive,
      focusProps: {
        onFocus: () => {
          bareTriggerFocused.current = true;
        },
        onBlur: () => {
          bareTriggerFocused.current = false;
        },
      },
    });
  }

  const isCoworker = profile.kind === "coworker";
  const isSokoBot = profile.kind === "sokoBot";
  const isAi = isCoworker || isSokoBot;
  // One subtitle per card, best available information first. The bot icon
  // beside the name already carries the kind ("AI coworker" or "Personal
  // assistant"), so the kind label is only the last resort for a personal
  // assistant with no caption.
  const detail =
    profile.kind === "human"
      ? profile.email
      : profile.kind === "sokoBot"
        ? profile.caption?.trim() || t("personalAssistantBadge")
        : profile.caption?.trim() || `@${profile.slug}`;
  const showOpenDirect = canShowOpenDirect({
    profile,
    currentUserId,
    canOpenHumanDirect,
    onOpenDirect,
  });

  return (
    <HoverCard openDelay={openDelay} closeDelay={closeDelay}>
      <HoverCardTrigger asChild>
        {renderHoverTrigger({
          profileName: profile.name,
          children,
          className,
          style,
          interactive,
          focusProps: { ref: focusOnAttach },
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
            {isSokoBot && profile.avatarSeed && !profile.image ? (
              <AuroraOrb
                seed={profile.avatarSeed}
                size={96}
                alt=""
                className="ring-border/40 size-12 ring-1"
              />
            ) : (
              <Avatar className="size-12">
                <AvatarImage src={profile.image ?? undefined} alt="" />
                <AvatarFallback
                  className={cn(
                    "text-sm",
                    isAi
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {getInitials(profile.name)}
                </AvatarFallback>
              </Avatar>
            )}
            <LiveMemberPresenceDot
              className="absolute -right-0.5 -bottom-0.5 size-3"
              fallback={profile.presence}
              ground="popover"
              isCoworker={isAi}
              userId={profile.id}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <p className="truncate text-sm font-semibold">{profile.name}</p>
              {isAi ? (
                <AiCoworkerIcon
                  className="size-3.5 shrink-0"
                  label={isSokoBot ? t("personalAssistantBadge") : undefined}
                />
              ) : null}
            </div>
            {/* Sighted affordance, humans only: coworkers are pinned online
                (ADR-0003), so the word would be a constant there and the dot
                already carries it. Radix's hover card emits no ARIA and portals
                to the end of the body with nothing pointing back at the trigger,
                so this text is reachable by a virtual cursor while the card is
                open but is never tied to the person who opened it. Availability
                reaches assistive technology from the roster panel, which puts
                it in a hidden sibling on each row, and from the sidebar row of
                a 1:1 direct.
                `block` because `space-y-1` sets margin-top on siblings, which
                an inline box ignores. */}
            {isAi ? null : (
              <LiveMemberPresenceText
                className="block text-xs font-medium"
                fallback={profile.presence}
                userId={profile.id}
              />
            )}
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
