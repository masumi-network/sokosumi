import type { TaskPriority } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const BARS = [
  { x: 2, y: 9, height: 4 },
  { x: 6.5, y: 6, height: 7 },
  { x: 11, y: 3, height: 10 },
] as const;

const FILLED_BARS: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/** Rounded square with the "!" cut out (even-odd), so it needs no mask id. */
const URGENT_PATH =
  "M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3zM7.25 4h1.5v5h-1.5zM8 10.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z";

interface TaskPriorityIconProps {
  priority: TaskPriority;
  /** Accessible name. Without it the icon is decorative. */
  label?: string;
  className?: string;
}

/**
 * Linear-style priority glyph in `currentColor`: dashes for none, one to three
 * signal bars for low to high, a filled "!" square for urgent. Urgent takes
 * the destructive token, the only accent; none is muted.
 */
export function TaskPriorityIcon({
  priority,
  label,
  className,
}: TaskPriorityIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={cn(
        "size-4 shrink-0",
        priority === "URGENT" && "text-destructive",
        priority === "NONE" && "text-muted-foreground",
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-priority={priority}
    >
      {priority === "NONE" ? (
        [1.5, 6.5, 11.5].map((x) => (
          <rect key={x} x={x} y={7.25} width={3} height={1.5} rx={0.75} />
        ))
      ) : priority === "URGENT" ? (
        <path fillRule="evenodd" clipRule="evenodd" d={URGENT_PATH} />
      ) : (
        BARS.map((bar, index) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width={2.5}
            height={bar.height}
            rx={0.75}
            opacity={index < FILLED_BARS[priority] ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}
