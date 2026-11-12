"use client";

import { Check } from "lucide-react";

/** Done (green, check), working (dashed, dot) or not yet (hairline). */
interface ChecklistItem {
  label: string;
  state: "done" | "working" | "next";
}

interface ChecklistProps {
  items: ChecklistItem[];
  /** "ob-chips" lays the same items out in a row. */
  className?: string;
}

export function Checklist({
  items,
  className = "ob-checklist",
}: ChecklistProps) {
  return (
    <ol className={className}>
      {items.map((item) => (
        <li key={item.label} className={item.state}>
          <span className="ob-box" aria-hidden="true">
            {item.state === "done" ? (
              <Check size={12} strokeWidth={3} />
            ) : item.state === "working" ? (
              <span className="ob-box-dot" />
            ) : null}
          </span>
          {item.label}
          <span className="ob-sr">
            {item.state === "done"
              ? ", done"
              : item.state === "working"
                ? ", in progress"
                : ", not yet"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A section Cuso has not saved yet: a dashed outline, never a shimmer. */
export function SkeletonTile() {
  return (
    <div className="ob-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}
