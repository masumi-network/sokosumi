import Link from "next/link";
import type { ReactNode } from "react";
import { HOLDER_ITEM_HOVER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

const ROW_CLASS = cn(
  HOLDER_ITEM_HOVER_CLASS,
  "press flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors",
);

interface WorkspaceColumnRowProps {
  /** A 16px project avatar, or the kind's glyph when there is no project. */
  leading: ReactNode;
  title: string;
  detail?: string | null;
  time: string;
  /** A link for a plain destination; a handler where opening needs more. */
  target: { href: string } | { onClick: () => void };
}

/** One compact row of the Workspace column: avatar, two lines, time. */
export function WorkspaceColumnRow({
  leading,
  title,
  detail,
  time,
  target,
}: WorkspaceColumnRowProps) {
  // The time shares the title's line only, so the detail line below runs
  // the row's full width instead of stopping at the time's column.
  const body = (
    <>
      <span className="mt-0.5 flex shrink-0">{leading}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm break-words">
            {title}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {time}
          </span>
        </span>
        {detail ? (
          <span className="text-muted-foreground truncate text-xs">
            {detail}
          </span>
        ) : null}
      </span>
    </>
  );

  return "href" in target ? (
    <Link href={target.href} className={ROW_CLASS}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={target.onClick} className={ROW_CLASS}>
      {body}
    </button>
  );
}
