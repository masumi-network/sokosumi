"use client";

import { cn } from "@/lib/utils";

/**
 * The frame every layout shares: a bordered list that the groups divide.
 *
 * Kept in one place so the twenty differ in their controls rather than in their
 * padding, and so a fix to the small-screen behaviour lands in all twenty.
 */
export function SubjectList({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-border bg-card divide-y overflow-hidden rounded-lg border">
      {children}
    </div>
  );
}

export function SubjectRowShell({
  title,
  description,
  controls,
  muted = false,
}: {
  /** Left out when the group heading above already names this row. */
  title?: string | null;
  description?: string | null;
  controls: React.ReactNode;
  /** Dims the controls without disabling them, for a muted group. */
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {title ? (
          <p className="text-sm leading-5 font-medium">{title}</p>
        ) : null}
        {description ? (
          <p className="text-muted-foreground text-sm leading-6">
            {description}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 transition-opacity sm:justify-end",
          muted && "opacity-50",
        )}
      >
        {controls}
      </div>
    </div>
  );
}
