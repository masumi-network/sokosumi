import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Buzz's mark (block/buzz-app, Apache-2.0) as its app icon draws it: the bee in
 * Buzz yellow on black. A brand mark, so it keeps Buzz's own colors in both
 * themes. Size and corner radius come from `className`.
 */
export function BuzzLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ backgroundColor: "#000000" }}
      aria-hidden
    >
      <BuzzBee className="w-2/3" />
    </span>
  );
}

/**
 * Buzz's bee on black as a wide banner, the cover of the sidebar card: the
 * same 16:7 frame the announcement covers use.
 */
export function BuzzBanner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex aspect-16/7 w-full items-center justify-center",
        className,
      )}
      style={{ backgroundColor: "#000000" }}
      aria-hidden
    >
      <BuzzBee className="h-1/2" />
    </span>
  );
}

/** The bee itself, in Buzz yellow; its frame decides the size. */
function BuzzBee({ className }: { className?: string }) {
  const mask = useId();
  return (
    <svg viewBox="0 0 64 48" className={className}>
      <mask id={mask}>
        <rect width="64" height="48" fill="#ffffff" />
        <circle cx="25" cy="14" r="4" fill="#000000" />
        <circle cx="39" cy="14" r="4" fill="#000000" />
        <rect x="23" y="24" width="18" height="5" fill="#000000" />
        <rect x="23" y="35" width="18" height="5" fill="#000000" />
      </mask>
      <path
        d="M18 9a8 8 0 0 1 8-8h12a8 8 0 0 1 8 8v3h4a12 12 0 1 1 0 24h-4v3a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8v-3h-4a12 12 0 1 1 0-24h4V9Z"
        fill="#d7d72e"
        mask={`url(#${mask})`}
      />
    </svg>
  );
}
