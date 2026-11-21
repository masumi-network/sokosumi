import { cn } from "@/lib/utils";

interface ColumnHeaderProps {
  title: string;
  /** Left out while the board loads: no count until the server answers. */
  count?: number;
  statusColorClass: string;
}

export function ColumnHeader({
  title,
  count,
  statusColorClass,
}: ColumnHeaderProps) {
  return (
    // The inset is the card's: 8px list padding, 1px border, 12px padding. The
    // gutter matches the list below, so the count ends where the cards' content
    // does whether or not the list shows a scrollbar.
    <header className="flex items-center justify-between gap-2 overflow-y-hidden px-[21px] pt-3 pb-2 [scrollbar-gutter:stable] app-scrollbar">
      <div className="flex min-w-0 items-center gap-2">
        {/* The dot sits in the 14px box a card's status marker fills. */}
        <span
          className="flex size-3.5 shrink-0 items-center justify-center"
          aria-hidden
        >
          <span className={cn("size-2 rounded-full", statusColorClass)} />
        </span>
        <h2 className="text-foreground truncate text-sm font-medium">
          {title}
        </h2>
      </div>
      {count === undefined ? null : (
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      )}
    </header>
  );
}
