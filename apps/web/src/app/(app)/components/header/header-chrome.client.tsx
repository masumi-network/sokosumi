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
 * Fixed header aligned to the right of the desktop sidebar.
 * Outer shell keeps the Apple scrim across the full chrome (incl. safe-area pad).
 * Opaque underlay paints solid --background in the top inset so the scrim
 * never shows an empty/black notch.
 *
 * The rule lives on the inner `h-16` row so the header and its rule keep
 * the same height as the desktop offset.
 */
export function HeaderChrome({ className, children }: HeaderChromeProps) {
  return (
    <header
      className={cn(
        // `fixed` forms the absolute underlay containing block.
        // Do not add `relative` — it conflicts with `fixed` in the Tailwind cascade.
        "border-grid fixed inset-x-0 top-0 z-50 w-full md:start-[calc(var(--app-rail-width)+var(--sidebar-width))] md:w-auto md:sidebar-hidden:start-(--app-rail-width) md:bg-sidebar md:pl-0 md:pr-0 dark:md:bg-sidebar",
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
          "relative z-10 flex h-16 w-full items-center justify-between gap-1 px-2 md:gap-3 md:border-b md:border-sidebar-border md:px-4",
          className,
        )}
      >
        {children}
      </div>
    </header>
  );
}
