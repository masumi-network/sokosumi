import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface MetaItem {
  label: string;
  value: ReactNode;
  /** Render the value in monospace (ids, hashes). */
  mono?: boolean;
}

interface MetaGridProps {
  items: MetaItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLUMN_CLASSES: Record<NonNullable<MetaGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/** Dense definition list on the 4px grid; a dash marks empty values. */
export function MetaGrid({ items, columns = 3, className }: MetaGridProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-3",
        COLUMN_CLASSES[columns],
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 space-y-0.5">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd
            className={cn(
              "text-foreground truncate text-sm",
              item.mono && "font-mono text-xs",
            )}
          >
            {item.value === null ||
            item.value === undefined ||
            item.value === "" ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
