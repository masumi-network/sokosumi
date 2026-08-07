"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

interface HeaderTrailingProps {
  children: ReactNode;
}

/**
 * Trailing app-header chrome (workspace switch, notifications, account).
 * Hidden on mobile room routes so portaled room actions can use the space.
 */
export function HeaderTrailing({ children }: HeaderTrailingProps) {
  const pathname = usePathname();
  const hideOnMobileRoom = isChatRoomPathname(pathname);

  return (
    <div
      className={cn(
        "ml-auto flex min-w-0 shrink-0 items-center gap-2",
        hideOnMobileRoom && "max-md:hidden",
      )}
      data-testid="header-trailing"
      data-hide-on-mobile-room={hideOnMobileRoom ? "true" : undefined}
    >
      {children}
    </div>
  );
}
