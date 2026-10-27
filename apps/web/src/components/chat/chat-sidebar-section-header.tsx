"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SidebarRowSlot } from "@/components/ui/sidebar";
import { SIDEBAR_ROW_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";
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
 * A closed section hides its rooms, and with them whatever they held for the
 * reader. `closedAttention` says so on the heading: the row's own bold on the
 * title, and the room row's unread/mention string in its accessible name. An
 * open section passes none, because its rooms speak for themselves.
 */
export function ChatSidebarSectionHeader({
  children,
  isOpen,
  closedAttention = null,
  createAction,
  secondaryAction,
}: {
  /** The section's title. */
  children: string;
  isOpen: boolean;
  closedAttention?: SectionAttention;
  createAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const tChannels = useTranslations("App.Channels");
  const trailingCount = (secondaryAction ? 1 : 0) + (createAction ? 1 : 0);
  const attention = isOpen ? null : closedAttention;
  const attentionLabel =
    attention === "mention"
      ? tChannels("RoomMentions.mentionsYou")
      : attention === "unread"
        ? tChannels("RoomUnread.unread")
        : null;

  return (
    <div className={cn(SIDEBAR_ROW_CLASS, "relative")}>
      <CollapsibleTrigger
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
        {/* In the shared slot, so the title starts on the rooms' 48px
            column. */}
        <SidebarRowSlot>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none md:size-3",
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
  );
}

/**
 * The rooms under a section heading, sliding on the same motion as the
 * Projects disclosure in the main sidebar: height travels with the rows, so
 * every section below moves with them instead of jumping.
 *
 * The height animation needs `overflow-hidden`, which would otherwise clip a
 * row's focus `ring-2` where the rows meet the box's edges. A negative margin
 * pushes the clip edge out — by the group's gutter sideways, by the ring's
 * 2px vertically — and the padding puts the rows back where they were. The
 * ring is a fixed 2px, not a spacing step, so the vertical pair is in `px`:
 * on the scale it would be `0.125rem` and come out under 2px below a 16px
 * root, where the ring would lose part of its stroke again.
 *
 * Outer height is unchanged (−2px margin, +2px padding), so the collapse
 * animation and the gap to the next section stay as they were. What the
 * negative margin does change is hit testing: the 2px strip lies over the
 * bottom of the section heading above, which paints earlier and would lose
 * those hits. So the box itself takes no pointer events and hands them back
 * on its rows, which start inside the padding and leave the strip to the
 * heading.
 */
export function ChatSidebarSectionContent({
  children,
  className,
}: {
  children: ReactNode;
  /** For a section whose rows leave the box on their own — see Pinned. */
  className?: string;
}) {
  return (
    <CollapsibleContent
      className={cn(
        "motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down -mx-2 -my-[2px] overflow-hidden px-2 py-[2px] pointer-events-none [&>*]:pointer-events-auto",
        className,
      )}
    >
      {children}
    </CollapsibleContent>
  );
}
