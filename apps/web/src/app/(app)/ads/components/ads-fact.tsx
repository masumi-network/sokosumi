import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A list of labelled facts, one column unless the caller widens it. */
export function AdsFacts({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={cn("grid gap-x-6 gap-y-5", className)}>{children}</dl>;
}

/** A small muted label over its value. */
export function AdsFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Several values of one fact, a line each. */
export function AdsFactList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>{item}</li>
      ))}
    </ul>
  );
}
