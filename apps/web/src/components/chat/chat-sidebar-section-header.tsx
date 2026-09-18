"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useRef,
} from "react";
import { flushSync } from "react-dom";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SIDEBAR_ROW_CLASS,
  SidebarMenuButton,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { RailAttentionPill } from "./chat-room-sidebar-row";
import type { SectionAttention } from "./room-attention";

/**
 * Collapsible section heading for the chat sidebar (Channels, External,
 * Archived, Direct Messages).
 *
 * The trailing padding steps with how many action controls sit in the
 * absolutely-positioned trailing slot, so a long section title truncates
 * before it runs under them. Below `md` each control reaches 44px through a
 * pseudo-element, and the slot's gap keeps those two targets from overlapping.
 *
 * A section with a `railIcon` keeps its heading on the collapsed rail, as the
 * same 32px square every rail item is: the icon names the section, the
 * tooltip spells it out, and pressing it opens or closes the section there
 * too. It stands where the expanded heading's 32px row stood, so the rooms
 * under it keep their place when the sidebar toggles, and it marks where one
 * section ends and the next begins. Both headings are rendered and CSS picks
 * one, the same way a Channel row carries its glyph and its tile.
 *
 * `onRailPress` is for a section whose rows never reach the rail — Archived,
 * whose rows are static and carry a Restore menu a 32px square has no room
 * for. Opening it there would dim a square and show nothing, so its square
 * expands the sidebar instead, the way a pending invitation's tile does, and
 * the caller opens the section on the way. Focus follows to the expanded
 * heading, because the square the reader pressed is gone by then and a
 * hidden button drops a keyboard reader on the body.
 *
 * A closed section hides its rooms, and with them whatever they held for the
 * reader. `closedAttention` says so on the heading: the row's own bold on the
 * expanded title, the Rail attention pill beside the rail square. The pill is
 * decorative, so the heading also carries the room row's rail unread/mention
 * strings in its accessible name. An open section passes none, because its
 * rooms speak for themselves.
 */
export function ChatSidebarSectionHeader({
  children,
  isOpen,
  railIcon: RailIcon,
  closedAttention = null,
  onRailPress,
  createAction,
  secondaryAction,
}: {
  /** The section's title. A string, because the rail's tooltip shows it too. */
  children: string;
  isOpen: boolean;
  railIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  closedAttention?: SectionAttention;
  /** Rail square expands the sidebar and runs this, instead of toggling. */
  onRailPress?: () => void;
  createAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const tChannels = useTranslations("App.Channels");
  const expandedTriggerRef = useRef<HTMLButtonElement>(null);
  const trailingCount = (secondaryAction ? 1 : 0) + (createAction ? 1 : 0);
  const attention = isOpen ? null : closedAttention;
  const attentionLabel =
    attention === "mention"
      ? tChannels("RoomMentions.railMention")
      : attention === "unread"
        ? tChannels("RoomUnread.railUnread")
        : null;

  const railContent = RailIcon ? (
    <>
      <SidebarRowSlot>
        <RailIcon aria-hidden className="size-4" />
      </SidebarRowSlot>
      <span className="sr-only">{children}</span>
      {attentionLabel ? (
        <span className="sr-only">{attentionLabel}</span>
      ) : null}
    </>
  ) : null;

  return (
    <>
      <div
        className={cn(
          SIDEBAR_ROW_CLASS,
          "group-data-[collapsible=icon]:hidden relative",
        )}
      >
        <CollapsibleTrigger
          ref={expandedTriggerRef}
          className={cn(
            "text-muted-foreground hover:text-foreground ring-sidebar-ring flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-base font-medium outline-hidden transition-colors focus-visible:ring-2 md:text-xs",
            attention && "text-foreground font-semibold",
            trailingCount === 1 && "pr-9",
            trailingCount >= 2 && "pr-20",
            trailingCount === 0 && "md:pr-0",
            trailingCount === 1 && "md:pr-8",
            trailingCount >= 2 && "md:pr-14",
          )}
        >
          {/* In the shared slot, so the chevron sits where the section's rail
              icon sits and the title starts on the rooms' 48px column. */}
          <SidebarRowSlot>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 shrink-0 transition-transform motion-reduce:transition-none md:size-3",
                !isOpen && "-rotate-90",
              )}
            />
          </SidebarRowSlot>
          <span className="truncate">{children}</span>
          {attentionLabel ? (
            <span className="sr-only">{attentionLabel}</span>
          ) : null}
        </CollapsibleTrigger>
        {trailingCount > 0 ? (
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-3.5 md:gap-0">
            {secondaryAction}
            {createAction}
          </div>
        ) : null}
      </div>
      {RailIcon ? (
        <div
          data-slot="section-rail-header"
          className="relative hidden group-data-[collapsible=icon]:block"
        >
          {attention ? <RailAttentionPill variant={attention} /> : null}
          <SidebarMenuButton
            asChild={!onRailPress}
            type={onRailPress ? "button" : undefined}
            tooltip={children}
            onClick={
              onRailPress
                ? () => {
                    // The expanded heading is `display: none` until the
                    // sidebar commits its new state, so it cannot take focus
                    // before then.
                    flushSync(onRailPress);
                    expandedTriggerRef.current?.focus();
                  }
                : undefined
            }
            // `isOpen`, not `data-[state=closed]`: the tooltip trigger writes
            // its own `data-state` onto this same button and wins.
            className={cn("text-muted-foreground", !isOpen && "opacity-60")}
          >
            {onRailPress ? (
              railContent
            ) : (
              <CollapsibleTrigger>{railContent}</CollapsibleTrigger>
            )}
          </SidebarMenuButton>
        </div>
      ) : null}
    </>
  );
}
