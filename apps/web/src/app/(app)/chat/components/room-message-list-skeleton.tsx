import { CHAT_MESSAGE_LIST_CONTENT_CLASS } from "@/app/chat/chat-message-list-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Centred reading column for a room's transcript and composer slot. After the
 * padding and avatar gutter, message text gets about 810px, a little more than
 * ChatGPT's 768px column, so 14px Inter stays at or under about 120 characters
 * per line. Rem, so the column grows with Dynamic Type and keeps that measure.
 * The scroller stays full width so its scrollbar keeps to the pane edge.
 * Applied by the room shell, not `RoomComposer`, so the thread panel and home
 * composer keep their width.
 *
 * When a side panel docks (thread, threads, pinned, members) the column keeps
 * its left edge while it still fits, then moves left only as far as it must,
 * and narrows only at the pane edge. `100cqw` is the whole room pane
 * (`@container` on `ROOM_SHELL_MAIN_CLASSNAME`), so `(100cqw-56rem)/2` is the
 * closed-state centring margin; `100%-56rem` is the room left beside the panel.
 * 56rem is `--container-4xl`, the same token `max-w-4xl` reads.
 * `w-auto` lets the stretched flex item take what is left after that margin.
 */
export const ROOM_CONTENT_COLUMN_CLASSNAME =
  "w-auto max-w-4xl ms-[max(0px,min((100cqw-var(--container-4xl))/2,100%-var(--container-4xl)))]";

/**
 * Outer padding for room message list content (skeleton + live).
 * Instant loading and progressive shell must share this exactly.
 * The bottom padding is the last message's clearance above the composer box.
 */
export const ROOM_MESSAGE_LIST_CONTENT_CLASSNAME = cn(
  CHAT_MESSAGE_LIST_CONTENT_CLASS,
  ROOM_CONTENT_COLUMN_CLASSNAME,
  "px-5 pt-6 pb-2 md:pb-3",
);

interface MessageSkeletonRow {
  /** Author name bone width. */
  nameClassName: string;
  /** Body column max width. */
  bodyWidthClassName: string;
  /** Line bones under the name (widths as Tailwind classes). */
  lineClassNames: string[];
  /** Optional attachment / image placeholder under the lines. */
  imageClassName?: string;
}

/** Varied left-aligned transcript bones (no right-aligned “own” rows). */
const MESSAGE_SKELETON_ROWS: MessageSkeletonRow[] = [
  {
    nameClassName: "w-16",
    bodyWidthClassName: "w-[min(100%,12rem)]",
    lineClassNames: ["w-full"],
  },
  {
    nameClassName: "w-24",
    bodyWidthClassName: "w-[min(100%,20rem)]",
    lineClassNames: ["w-full", "w-[92%]", "w-[55%]"],
  },
  {
    nameClassName: "w-20",
    bodyWidthClassName: "w-[min(100%,16rem)]",
    lineClassNames: ["w-full", "w-[70%]"],
  },
  {
    nameClassName: "w-28",
    bodyWidthClassName: "w-[min(100%,18rem)]",
    lineClassNames: ["w-[85%]"],
    imageClassName: "h-28 w-full max-w-[14rem] rounded-lg",
  },
  {
    nameClassName: "w-14",
    bodyWidthClassName: "w-[min(100%,22rem)]",
    lineClassNames: ["w-full", "w-full", "w-[88%]", "w-[40%]"],
  },
  {
    nameClassName: "w-[4.5rem]",
    bodyWidthClassName: "w-[min(100%,15rem)]",
    lineClassNames: ["w-full", "w-[60%]"],
  },
];

/**
 * Message-list only skeleton. Left-aligned rows only (matches live room
 * transcript — no right-aligned “own message” bones). Multiline + mixed
 * widths; one row includes an image bone.
 */
export function RoomMessageListSkeleton({
  className,
}: {
  className?: string;
} = {}): React.ReactElement {
  return (
    <div
      data-slot="room-message-list-skeleton"
      data-testid="room-message-list-skeleton"
      className={cn("flex min-w-0 w-full flex-col gap-5", className)}
      aria-hidden
    >
      {MESSAGE_SKELETON_ROWS.map((row, index) => (
        <div key={index} className="flex flex-row gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className={cn("min-w-0 space-y-2", row.bodyWidthClassName)}>
            <Skeleton className={cn("h-3", row.nameClassName)} />
            <div className="space-y-1.5">
              {row.lineClassNames.map((lineClassName, lineIndex) => (
                <Skeleton
                  key={lineIndex}
                  className={cn("h-3 rounded-sm", lineClassName)}
                />
              ))}
            </div>
            {row.imageClassName ? (
              <Skeleton
                data-testid="room-message-list-skeleton-image"
                className={row.imageClassName}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
