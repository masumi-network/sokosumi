import type { ReactNode } from "react";

import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** One titled panel of the page: the light-gray holder with its label. */
export function CompetitorsPanel({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  /** A short fact that belongs to the panel, beside its title. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
    >
      <div className="flex items-baseline justify-between gap-3 px-2 pt-1">
        <h2 className="text-muted-foreground text-xs font-medium" id={id}>
          {title}
        </h2>
        {aside ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A white, outlined item inside a panel. */
export function CompetitorsItem({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "px-4 py-3", className)}>
      {children}
    </div>
  );
}

/** What a panel says while it has nothing to show. */
export function CompetitorsEmpty({ children }: { children: ReactNode }) {
  return (
    <CompetitorsItem>
      <p className="text-muted-foreground text-sm">{children}</p>
    </CompetitorsItem>
  );
}
