"use client";

import { MessagesSquare } from "lucide-react";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UnreadThreadsPanelLabels {
  open: string;
  /** Accessible unread statement, e.g. `3 unread threads`. */
  unreadThreads: (count: number) => string;
  /** The same statement once the digits are capped, e.g. `More than 99`. */
  unreadThreadsCapped: (max: number) => string;
}

interface UnreadThreadsPanelProps {
  labels: UnreadThreadsPanelLabels;
  isOpen: boolean;
  onToggle: () => void;
  /** Unread threads in this room (Core `unread-count`, Participant-gated). */
  unreadCount: number;
  /** The reader's opt-in numeric chat counts. */
  showUnreadCount: boolean;
}

/**
 * The room-header threads trigger.
 *
 * It speaks the sidebar's attention language: a mark says *something is here*,
 * the number says *how much*, and the number only appears for a reader who
 * asked for numbers. Opening the panel suppresses neither: looking at a list is
 * not reading it, so the mark stands until a Look or a Mark all actually zeroes
 * the count. The sidebar row makes the same call for the room it is open on.
 *
 * Without a number the mark has to carry the whole statement, so it is a dot,
 * not a heavier glyph: a stroke going from 2 to 2.5 on a 16px icon is not a
 * difference a reader notices in a header full of icons. The dot is the same
 * `bg-primary` dot the thread list puts beside an unread thread, so one mark
 * means one thing across the threads surface. When the number shows, the dot
 * stands down rather than saying the same thing twice.
 *
 * The unread statement rides the button's `aria-label`. A label on the button
 * replaces anything its children say, so `sr-only` text inside would never be
 * announced. It states the unread threads whether or not the reader turned
 * numeric counts on: that preference sets how dense the chrome looks, and a
 * spoken name has no density to save. The sidebar row drops its spoken count
 * with the preference; this deliberately does not.
 *
 * Past the cap the name says "more than 99" rather than the exact figure,
 * so a reader who hears the button and a reader who sees it are told the same
 * thing. The sidebar row states its own capped counts the same way.
 */
export function UnreadThreadsPanel({
  labels,
  isOpen,
  onToggle,
  unreadCount,
  showUnreadCount,
}: UnreadThreadsPanelProps) {
  const hasUnread = unreadCount > 0;
  const showCount = hasUnread && showUnreadCount;
  const spokenUnread =
    unreadCount > ROOM_COUNT_CAP
      ? labels.unreadThreadsCapped(ROOM_COUNT_CAP)
      : labels.unreadThreads(unreadCount);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={hasUnread ? `${labels.open}, ${spokenUnread}` : labels.open}
      aria-expanded={isOpen}
      data-testid="unread-threads-trigger"
      data-unread={hasUnread ? "true" : "false"}
      className={cn("relative size-8", showCount && "w-auto gap-1 px-2")}
      onClick={onToggle}
    >
      <span className="relative flex items-center">
        <MessagesSquare className={cn("size-4", hasUnread && "stroke-[2.5]")} />
        {hasUnread && !showCount ? (
          // Ringed in the header's own ground so the dot stays a dot where it
          // overlaps the glyph.
          <span
            aria-hidden="true"
            data-testid="unread-threads-dot"
            className="bg-primary ring-background absolute -top-0.5 -right-1 size-2 rounded-full ring-2"
          />
        ) : null}
      </span>
      {showCount ? (
        <span
          aria-hidden="true"
          className="text-foreground text-xs leading-4 font-semibold tabular-nums"
        >
          {roomCountLabel(unreadCount)}
        </span>
      ) : null}
    </Button>
  );
}
