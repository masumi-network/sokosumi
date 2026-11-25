import type { ReactNode } from "react";

import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export function AgentsTag({ children }: { children: ReactNode }) {
  return (
    <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

/** Title and subtitle on the left, the page's actions on the right. */
export function AgentsPageHeader({
  title,
  subtitle,
  leading,
  tag,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  leading?: ReactNode;
  tag?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-1">
      <div className="flex min-w-0 items-center gap-4">
        {leading ? <span className="shrink-0">{leading}</span> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance md:text-3xl">
              {title}
            </h1>
            {tag ? <AgentsTag>{tag}</AgentsTag> : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm md:text-base">
            {subtitle}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** A heading, an optional note and link, and the light-gray panel below. */
export function AgentsSection({
  id,
  title,
  note,
  tag,
  action,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  tag?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-1">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2
              id={id}
              className="text-foreground text-lg font-semibold tracking-tight"
            >
              {title}
            </h2>
            {tag ? <AgentsTag>{tag}</AgentsTag> : null}
          </div>
          {note ? (
            <p className="text-muted-foreground text-sm text-pretty">{note}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>{children}</div>
    </section>
  );
}
