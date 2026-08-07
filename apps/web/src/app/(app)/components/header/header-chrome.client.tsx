"use client";

import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import { APP_HEADER_SAFE_AREA_PADDING_CLASS } from "../app-shell-safe-area";
import { mobileChromeSurfaceClass } from "../mobile-chrome-surface";

interface HeaderChromeProps {
  className?: string | undefined;
  children: React.ReactNode;
}

/**
 * Fixed mobile / sticky desktop app header.
 * Outer shell clears safe-area under root `viewport-fit=cover`; inner row
 * stays `h-16` so controls never sit in the notch or status area.
 */
export function HeaderChrome({ className, children }: HeaderChromeProps) {
  const isApple = useIsApplePlatform();

  return (
    <header
      className={cn(
        "border-grid fixed top-0 z-50 w-full border-b-0 md:sticky md:border-b md:bg-sidebar md:backdrop-blur-none md:backdrop-saturate-100 md:pl-0 md:pr-0 dark:md:bg-sidebar",
        APP_HEADER_SAFE_AREA_PADDING_CLASS,
        mobileChromeSurfaceClass(isApple),
      )}
    >
      <div
        className={cn(
          "flex h-16 w-full items-center justify-between gap-2 md:items-center md:pl-6",
          className,
        )}
      >
        {children}
      </div>
    </header>
  );
}
