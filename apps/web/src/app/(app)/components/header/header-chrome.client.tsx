"use client";

import { usePathname } from "next/navigation";
import { isChatChatsPathname } from "@/app/chat/utils/chat-route-base";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
} from "../app-shell-safe-area";
import { mobileChromeSurfaceClass } from "../mobile-chrome-surface";

interface HeaderChromeProps {
  className?: string | undefined;
  children: React.ReactNode;
}

/**
 * Fixed mobile / sticky desktop app header.
 * Outer shell keeps Apple glass across the full chrome (incl. safe-area pad).
 * Opaque underlay paints solid --background in the top inset so backdrop-blur
 * never shows empty/black notch sampling. Inner row is h-20 on mobile
 * `/chat/chats`, h-16 elsewhere (md+ always h-16).
 */
export function HeaderChrome({ className, children }: HeaderChromeProps) {
  const pathname = usePathname();
  const isApple = useIsApplePlatform();
  const isMobileChatsList = isChatChatsPathname(pathname);

  return (
    <header
      className={cn(
        // `fixed` / `md:sticky` already form the absolute underlay containing block.
        // Do not add `relative` — it conflicts with `fixed` in the Tailwind cascade.
        "border-grid fixed top-0 z-50 w-full border-b-0 md:sticky md:border-b md:bg-sidebar md:backdrop-blur-none md:backdrop-saturate-100 md:pl-0 md:pr-0 dark:md:bg-sidebar",
        APP_HEADER_SAFE_AREA_PADDING_CLASS,
        mobileChromeSurfaceClass(isApple),
      )}
    >
      <div
        aria-hidden="true"
        data-testid="header-safe-area-underlay"
        className={APP_HEADER_SAFE_AREA_UNDERLAY_CLASS}
      />

      <div
        className={cn(
          "relative z-10 flex w-full items-center justify-between gap-2 md:items-center md:pl-6",
          isMobileChatsList ? "h-20 md:h-16" : "h-16",
          className,
        )}
      >
        {children}
      </div>
    </header>
  );
}
