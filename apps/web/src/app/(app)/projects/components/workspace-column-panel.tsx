"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { WORKSPACE_COLUMN_STACKED_ROWS } from "@/app/projects/constants";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

type WorkspaceColumnPanelAction =
  /** A link out, at every width: Needs you opens the Notification Center view. */
  | { kind: "link"; label: string; href: string; onClick?: () => void }
  /** Stacked only: shows the rows the cap hid, in place. */
  | { kind: "expand"; label: string };

interface WorkspaceColumnPanelProps {
  testId: string;
  title: string;
  rows: Array<{ key: string; node: ReactNode }>;
  /** The one line a panel with no rows says. */
  empty: string;
  action?: WorkspaceColumnPanelAction;
}

/**
 * One panel of the Workspace column: a heading, its action, and compact rows
 * in one bordered list. Under `xl` the column stacks above the grid and each
 * panel shows its first three rows, so the grid stays near the top.
 */
export function WorkspaceColumnPanel({
  testId,
  title,
  rows,
  empty,
  action,
}: WorkspaceColumnPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isCapped = rows.length > WORKSPACE_COLUMN_STACKED_ROWS && !isExpanded;
  const showExpand = action?.kind === "expand" && isCapped;

  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
    >
      <div className="flex min-h-6 items-center justify-between gap-3 px-2">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        {action?.kind === "link" && rows.length > 0 ? (
          <Link
            href={action.href}
            onClick={action.onClick}
            className="text-muted-foreground hover:text-foreground rounded-sm text-xs font-medium transition-colors"
          >
            {action.label}
          </Link>
        ) : null}
        {showExpand ? (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm text-xs font-medium transition-colors xl:hidden"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul
          className={cn(
            HOLDER_ITEM_CLASS,
            "divide-border flex flex-col divide-y overflow-hidden",
          )}
        >
          {rows.map((row, index) => (
            <li
              key={row.key}
              data-testid={`${testId}-row`}
              className={cn(
                isCapped &&
                  index >= WORKSPACE_COLUMN_STACKED_ROWS &&
                  "max-xl:hidden",
              )}
            >
              {row.node}
            </li>
          ))}
        </ul>
      ) : (
        <p
          data-testid={`${testId}-empty`}
          className={cn(
            HOLDER_ITEM_CLASS,
            "text-muted-foreground px-3 py-2.5 text-sm",
          )}
        >
          {empty}
        </p>
      )}
    </section>
  );
}
