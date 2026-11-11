import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Buzz's brand, as buzz.xyz and its app draw it: the bee mark (block/buzz-app,
 * Apache-2.0), Buzz yellow, near-black ink, a dotted ground and dark pill
 * buttons. Brand colors stay Buzz's own in both themes, so they live here,
 * in the brand-mark allowlist, and nowhere else.
 */
const YELLOW = "#d7d72e";
const INK = "#231e1e";
const PALE_BEE = "#f2f2dc";

/** The app icon: the bee in Buzz yellow on black. Size and radius from `className`. */
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
      <BuzzBee className="w-2/3" color={YELLOW} />
    </span>
  );
}

/**
 * A Buzz-branded surface: yellow with the dotted ground and a few bees, as on
 * buzz.xyz. Ink text inside.
 */
export function BuzzSurface({
  className,
  children,
  bees = true,
}: {
  className?: string;
  children: ReactNode;
  /** The scattered bees; off where text fills the surface. */
  bees?: boolean;
}) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        backgroundColor: YELLOW,
        color: INK,
        backgroundImage: `radial-gradient(${INK}26 1px, transparent 1.2px)`,
        backgroundSize: "14px 14px",
      }}
    >
      {bees ? (
        <span aria-hidden>
          <BuzzBee
            className="absolute top-3 right-10 w-4 rotate-[18deg]"
            color={PALE_BEE}
          />
          <BuzzBee
            className="absolute top-9 right-4 w-3 -rotate-12"
            color={PALE_BEE}
          />
          <BuzzBee
            className="absolute top-14 right-14 w-3 rotate-[40deg]"
            color={PALE_BEE}
          />
        </span>
      ) : null}
      <div className="relative">{children}</div>
    </div>
  );
}

/** The bee in ink, the mark buzz.xyz leads with. */
export function BuzzMark({ className }: { className?: string }) {
  return <BuzzBee className={className} color={INK} />;
}

/** A Buzz pill: ink with yellow text, like "Get the app" on buzz.xyz. */
export function BuzzPill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold"
      style={{ backgroundColor: INK, color: YELLOW }}
    >
      {children}
    </span>
  );
}

/**
 * Inline colors for a Buzz action on our Button: ink with yellow text, a
 * pill. Put `rounded-full` on the button; the colors come from here.
 */
export const BUZZ_ACTION_STYLE = {
  backgroundColor: INK,
  color: YELLOW,
} as const;

/** A step's icon: the symbol in Buzz yellow on an ink tile. */
export function BuzzIconTile({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-16 items-center justify-center rounded-2xl [&>svg]:size-7"
      style={{ backgroundColor: INK, color: YELLOW }}
    >
      {children}
    </span>
  );
}

/** The bee itself in one color; its frame decides the size. */
function BuzzBee({ className, color }: { className?: string; color: string }) {
  const mask = useId();
  return (
    <svg viewBox="0 0 64 48" className={className} aria-hidden>
      <mask id={mask}>
        <rect width="64" height="48" fill="#ffffff" />
        <circle cx="25" cy="14" r="4" fill="#000000" />
        <circle cx="39" cy="14" r="4" fill="#000000" />
        <rect x="23" y="24" width="18" height="5" fill="#000000" />
        <rect x="23" y="35" width="18" height="5" fill="#000000" />
      </mask>
      <path
        d="M18 9a8 8 0 0 1 8-8h12a8 8 0 0 1 8 8v3h4a12 12 0 1 1 0 24h-4v3a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8v-3h-4a12 12 0 1 1 0-24h4V9Z"
        fill={color}
        mask={`url(#${mask})`}
      />
    </svg>
  );
}
