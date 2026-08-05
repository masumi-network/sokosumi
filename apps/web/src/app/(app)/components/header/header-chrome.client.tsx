"use client";

import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import { mobileChromeSurfaceClass } from "../mobile-chrome-surface";

interface HeaderChromeProps {
  className?: string | undefined;
  children: React.ReactNode;
}

export function HeaderChrome({ className, children }: HeaderChromeProps) {
  const isApple = useIsApplePlatform();

  return (
    <header
      className={cn(
        "border-grid fixed top-0 z-50 flex w-full items-center justify-between gap-2 border-b-0 md:sticky md:items-center md:border-b md:bg-sidebar md:backdrop-blur-none md:backdrop-saturate-100 md:pl-6 dark:md:bg-sidebar",
        mobileChromeSurfaceClass(isApple),
        className,
      )}
    >
      {children}
    </header>
  );
}
