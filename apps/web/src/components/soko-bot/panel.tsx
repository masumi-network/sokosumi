import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PanelProps {
  title: string;
  description?: string;
  /** Right-aligned header slot (counts, actions). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding for edge-to-edge tables. */
  flush?: boolean;
  id?: string;
}

/** Bordered section: hairline header row + body. No shadows. */
export function Panel({
  title,
  description,
  aside,
  children,
  className,
  flush = false,
  id,
}: PanelProps) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn("bg-background rounded-md border", className)}
    >
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h2
            id={id ? `${id}-title` : undefined}
            className="text-sm font-semibold leading-5"
          >
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      <div className={cn(!flush && "p-4")}>{children}</div>
    </section>
  );
}
