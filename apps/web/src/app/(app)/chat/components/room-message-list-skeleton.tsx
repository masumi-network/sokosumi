import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Outer padding for room message list content (skeleton + live).
 * Instant loading and progressive shell must share this exactly.
 */
export const ROOM_MESSAGE_LIST_CONTENT_CLASSNAME =
  "flex min-h-full min-w-0 w-full flex-col justify-end px-5 pt-6 pb-0";

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
