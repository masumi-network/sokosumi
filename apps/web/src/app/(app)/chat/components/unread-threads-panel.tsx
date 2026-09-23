"use client";

import { MessagesSquare } from "lucide-react";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";
import { Button } from "@/components/ui/button";

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
}

/**
 * The room-header threads trigger.
 *
 * Unread threads show as a `bg-primary` badge holding the count, overlapping the
 * glyph's top-right corner. Opening the panel does not hide it: looking at a
 * list is not reading it, so the badge stands until a Look or a Mark all
 * actually zeroes the count. The sidebar row makes the same call for the room
 * it is open on.
 *
 * The badge shows even for a reader who switched numeric counts off. That
 * switch thins the sidebar, where every room would otherwise carry a number;
 * here there is one control, and the count is what makes it worth opening.
 * The sidebar row still honours the switch; this control deliberately does
 * not (ADR-0038).
 *
 * It is not a `MentionCountPill`. That pill says *you were named*: a tint with
 * an `@`, capped at 9 to fit a sidebar row's hole. This is a solid fill that
 * says *how much*, capped where the room counts cap. It is also smaller than
 * the notification bell's badge: its geometry is the thread-unread mock's,
 * sized to sit on a 16px glyph's corner in a row of header icons.
 *
 * The unread statement rides the button's `aria-label`, so the badge is
 * `aria-hidden`. A label on the button replaces anything its children say, so
 * `sr-only` text inside would never be announced.
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
}: UnreadThreadsPanelProps) {
  const hasUnread = unreadCount > 0;
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
      className="relative size-8"
      onClick={onToggle}
    >
      <MessagesSquare className="size-4" />
      {hasUnread ? (
        // Ringed in the header's own ground so the badge keeps its edge where
        // it overlaps the glyph's corner.
        <span
          aria-hidden="true"
          data-testid="unread-threads-badge"
          className="bg-primary text-primary-foreground ring-background absolute -top-px -right-0.5 inline-flex h-2.75 min-w-2.75 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-bold tabular-nums ring-2"
        >
          {roomCountLabel(unreadCount)}
        </span>
      ) : null}
    </Button>
  );
}
