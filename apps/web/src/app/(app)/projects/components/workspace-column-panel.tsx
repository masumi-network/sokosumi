"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { WORKSPACE_COLUMN_FOCUS_RING } from "./workspace-column-row";

const ACTION_CLASS = cn(
  WORKSPACE_COLUMN_FOCUS_RING,
  "text-muted-foreground hover:text-foreground cursor-pointer rounded-sm text-xs font-medium transition-colors",
);

/** A link out, at every width: Needs you opens the Notification Center view. */
interface WorkspaceColumnPanelAction {
  label: string;
  href: string;
  onClick?: () => void;
}

interface WorkspaceColumnPanelProps {
  testId: string;
  title: string;
  rows: Array<{ key: string; node: ReactNode }>;
  /** The one line a panel with no rows says. */
  empty: string;
  /** Shown whenever passed; a caller with nothing to link to leaves it out. */
  action?: WorkspaceColumnPanelAction;
}

/**
 * One panel of Home's board: a heading, its action, and compact rows in one
 * bordered list. Every row shows at every width; each feed already loads
 * only as many as Home has room for.
 */
export function WorkspaceColumnPanel({
  testId,
  title,
  rows,
  empty,
  action,
}: WorkspaceColumnPanelProps) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
    >
      <div className="flex min-h-6 items-center justify-between gap-3 px-2">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        {action ? (
          <Link
            href={action.href}
            onClick={action.onClick}
            className={ACTION_CLASS}
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul
          className={cn(
            HOLDER_ITEM_CLASS,
            "divide-border flex flex-col divide-y overflow-hidden",
          )}
        >
          {rows.map((row) => (
            <li key={row.key} data-testid={`${testId}-row`}>
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
