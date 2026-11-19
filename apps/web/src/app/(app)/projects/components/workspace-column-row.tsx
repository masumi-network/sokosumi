import Link from "next/link";
import type { ReactNode } from "react";
import { HOLDER_ITEM_HOVER_CLASS } from "@/components/ui/holder-surface";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { cn } from "@/lib/utils";

import { ProjectAvatar } from "./project-avatar";

/**
 * DESIGN.md's ring for bespoke clickable surfaces. The inset half stays
 * visible where the rows' rounded list clips the outer one.
 */
export const WORKSPACE_COLUMN_FOCUS_RING =
  "focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2";

const ROW_CLASS = cn(
  HOLDER_ITEM_HOVER_CLASS,
  WORKSPACE_COLUMN_FOCUS_RING,
  "press flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors",
);

/** The 16px project avatar a row leads with. The picker uses its 24px list avatar. */
export function WorkspaceColumnProjectAvatar({
  name,
  logo,
  inProjectPicker,
}: {
  name: string;
  logo: string | null;
  inProjectPicker?: boolean;
}) {
  return (
    <ProjectAvatar
      name={name}
      logo={logo}
      className={inProjectPicker ? "size-6 rounded-md" : "size-4 rounded-sm"}
      fallbackClassName={inProjectPicker ? "rounded-md" : "rounded-sm text-2xs"}
    />
  );
}

interface WorkspaceColumnRowProps {
  /** A 16px project avatar, or the kind's glyph when there is no project. The picker uses 24px. */
  leading: ReactNode;
  title: string;
  detail?: string | null;
  inProjectPicker?: boolean;
  time: string;
  /** A link for a plain destination; a handler where opening needs more. */
  target: { href: string; onNavigate?: () => void } | { onClick: () => void };
}

/** One compact row of the Workspace column: avatar, two lines, time. */
export function WorkspaceColumnRow({
  leading,
  title,
  detail,
  inProjectPicker,
  time,
  target,
}: WorkspaceColumnRowProps) {
  const rowClass = cn(
    ROW_CLASS,
    inProjectPicker && [POPOVER_ROW_CLASS, "items-center gap-3 px-2.5 py-1.5"],
  );
  // The time shares the title's line only, so the detail line below runs
  // the row's full width instead of stopping at the time's column.
  const body = (
    <>
      <span className={cn("flex shrink-0", !inProjectPicker && "mt-0.5")}>
        {leading}
      </span>
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
          <span
            className={cn(
              "text-muted-foreground text-xs",
              inProjectPicker ? "line-clamp-2 break-words" : "truncate",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </>
  );

  return "href" in target ? (
    <Link
      href={target.href}
      onNavigate={target.onNavigate}
      className={rowClass}
    >
      {body}
    </Link>
  ) : (
    <button type="button" onClick={target.onClick} className={rowClass}>
      {body}
    </button>
  );
}
