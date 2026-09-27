import type { ReactNode } from "react";

import { MentionCountPill } from "@/components/chat/mention-count-pill";
import { roomCountLabel } from "@/components/chat/room-count-label";
import { ThreadIconCircle } from "@/components/chat/thread-icon-circle";
import { cn } from "@/lib/utils";

/**
 * The Thread list's look, shared by the room's Thread panel and the Threads
 * page and flyout (SOK-1158, SOK-1159), so the two cannot drift apart again.
 *
 * Unread rows sit on the primary ramp's fill step and deepen to its hover
 * step: the one colour the list spends, on the rows that want the reader.
 * Read rows stay quiet on the neutral hover.
 */
export function threadListRowClassName(unread: boolean): string {
  return cn(
    "flex w-full min-w-0 gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
    unread
      ? "bg-primary-quinary hover:bg-primary-quaternary"
      : "hover:bg-accent",
  );
}

/**
 * Divides a Thread list into Unread and Earlier.
 *
 * A real heading, so the list has an outline to jump between rather than one
 * long run of rows. The count says how much the group holds before the eye
 * reaches it, tinted on the unread group only; the rule after it is
 * decoration and hidden.
 */
export function ThreadGroupHeading({
  children,
  count,
  id,
}: {
  children: string;
  /** Drawn only above zero, as a tinted pill. */
  count?: number;
  id?: string;
}) {
  return (
    <h3
      id={id}
      className="text-muted-foreground mt-3 mb-1.5 flex items-center gap-2 px-2 text-[0.625rem] font-medium tracking-[0.08em] uppercase"
      data-testid="thread-list-group-heading"
    >
      {children}
      {/* Seen only: the rows under the heading say how many, and a heading
          read aloud as "Unread 3" names the group by a number. */}
      {count && count > 0 ? (
        <span
          aria-hidden="true"
          className="bg-primary-quaternary text-primary-variant rounded-full px-1.5 text-[0.625rem] leading-4 font-semibold tracking-normal tabular-nums"
        >
          {roomCountLabel(count)}
        </span>
      ) : null}
      <span aria-hidden="true" className="bg-border h-px flex-1" />
    </h3>
  );
}

/** What stands under an empty Unread heading. */
export function ThreadGroupEmpty({ children }: { children: string }) {
  return (
    <p
      className="text-muted-foreground px-2 py-3 text-center text-xs"
      data-testid="thread-list-unread-empty"
    >
      {children}
    </p>
  );
}

interface ThreadListRowContentProps {
  unread: boolean;
  /** The Thread's name, from its parent message. */
  label: string;
  /** How long ago the newest reply (unread, where there is one) came. */
  time: string;
  /** Leads the second line on an unread row: "2 new", in primary. */
  newReplies?: string;
  /** The rest of the second line: who started it, or which room it is in. */
  meta: ReactNode;
  /** Replies naming the reader: the `@` mark and pill. */
  mentionCount?: number;
  /** The mention pill's words, since the pill itself is hidden from speech. */
  mentionLabel?: string;
  /** A state beside the time, such as the muted mark. */
  trailing?: ReactNode;
}

/**
 * One Thread row's inside, for a link or a button: the mark, the name over
 * its details, the time on the right. Wrap it in an element carrying
 * `threadListRowClassName`.
 */
export function ThreadListRowContent({
  unread,
  label,
  time,
  newReplies,
  meta,
  mentionCount = 0,
  mentionLabel,
  trailing,
}: ThreadListRowContentProps) {
  return (
    <>
      <ThreadIconCircle
        tone={unread ? "attention" : "read"}
        glyph={mentionCount > 0 ? "mention" : "thread"}
        size="md"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-start gap-2">
          <span
            className={cn(
              "line-clamp-2 min-w-0 flex-1",
              unread
                ? "text-foreground font-semibold"
                : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          {trailing}
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              unread
                ? "text-primary-variant font-medium"
                : "text-muted-foreground",
            )}
          >
            {time}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          {newReplies ? (
            <>
              <span className="text-primary-variant shrink-0 font-medium">
                {newReplies}
              </span>
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground min-w-0 truncate">{meta}</span>
          {mentionCount > 0 ? (
            <span className="ml-auto shrink-0">
              <span aria-hidden>
                <MentionCountPill count={mentionCount} />
              </span>
              {mentionLabel ? (
                <span className="sr-only">{mentionLabel}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
}
