"use client";

import { cn } from "@/lib/utils";

import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
} from "../app-shell-safe-area";

interface HeaderChromeProps {
  className?: string | undefined;
  children: React.ReactNode;
}

/**
 * Fixed mobile / sticky desktop app header.
 * Outer shell keeps the Apple scrim across the full chrome (incl. safe-area pad).
 * Opaque underlay paints solid --background in the top inset so the scrim
 * never shows an empty/black notch.
 *
 * Desktop bottom rule lives on the inner `h-16` row (border-box), matching
 * `SidebarHeader` (`h-16 border-b`) so the hairline is continuous across the
 * sidebar/content seam. Putting `border-b` on the outer auto-height shell
 * made the main bar 1px taller than the sidebar header.
 */
export function HeaderChrome({ className, children }: HeaderChromeProps) {
  return (
    <header
      className={cn(
        // `fixed` / `md:sticky` already form the absolute underlay containing block.
        // Do not add `relative` — it conflicts with `fixed` in the Tailwind cascade.
        "border-grid fixed top-0 z-50 w-full border-b-0 md:sticky md:bg-sidebar md:pl-0 md:pr-0 dark:md:bg-sidebar",
        APP_HEADER_SAFE_AREA_PADDING_CLASS,
        "bg-background",
      )}
    >
      <div
        aria-hidden="true"
        data-testid="header-safe-area-underlay"
        className={APP_HEADER_SAFE_AREA_UNDERLAY_CLASS}
      />

      <div
        className={cn(
          "relative z-10 flex h-16 w-full items-center justify-between gap-2 border-b-0 md:items-center md:border-b md:border-sidebar-border md:pl-6",
          className,
        )}
      >
        {children}
      </div>
    </header>
  );
}
