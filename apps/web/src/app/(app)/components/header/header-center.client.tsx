"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

interface HeaderCenterProps {
  children: ReactNode;
}

/**
 * App-header center: mobile room toolbar slot + breadcrumbs.
 * Room slot only claims space on chat room routes below `md`.
 * Breadcrumbs keep `sm` wayfinding on non-room pages; hidden below `md` on rooms.
 */
export function HeaderCenter({ children }: HeaderCenterProps) {
  const pathname = usePathname();
  const isMobileRoom = isChatRoomPathname(pathname);

  return (
    <>
      <div
        data-app-header-room-slot
        data-testid="header-room-slot"
        data-mobile-room={isMobileRoom ? "true" : undefined}
        className={cn(
          "min-w-0 flex-1 items-center gap-1.5 overflow-hidden md:hidden",
          isMobileRoom ? "flex" : "hidden",
        )}
      />

      <div
        data-testid="header-breadcrumbs"
        data-hide-on-mobile-room={isMobileRoom ? "true" : undefined}
        className={cn(
          "hidden min-w-0 flex-1 flex-row gap-2 sm:flex",
          isMobileRoom && "max-md:hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
