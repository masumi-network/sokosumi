"use client";

import { MessagesSquare } from "lucide-react";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";
import { CornerCountBadge } from "@/components/common/corner-count-badge";
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
 * Unread threads show as a primary badge holding the count on the button's
 * corner, the same badge the notification bell wears in the same filled
 * primary, so one header states counts one way. Opening the panel does not
 * hide it: looking at a list is not reading it, so the badge stands until a
 * Look or a Mark all actually zeroes the count. The sidebar row makes the same
 * call for the room it is open on.
 *
 * The badge shows even for a reader who switched numeric counts off. That
 * switch thins the sidebar, where every room would otherwise carry a number;
 * here there is one control, and the count is what makes it worth opening.
 * The sidebar row still honours the switch; this control deliberately does
 * not (ADR-0038).
 *
 * It shares `MentionCountPill`'s geometry but not its colour. That pill says
 * *you were named*: a tint with an `@`, capped at 9. This is a solid fill that
 * says *how much*, capped where the room counts cap.
 *
 * The unread statement rides the button's `aria-label`; the badge is hidden
 * from it. A label on the button replaces anything its children say, so
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
        // The ghost Button's 1px border moves the anchor in a pixel; the
        // offset puts the badge where the bell's sits.
        <CornerCountBadge
          data-testid="unread-threads-badge"
          className="bg-primary-solid text-primary-solid-foreground -top-0.75 -right-0.75"
        >
          {roomCountLabel(unreadCount)}
        </CornerCountBadge>
      ) : null}
    </Button>
  );
}
