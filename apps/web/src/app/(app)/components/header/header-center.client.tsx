"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

interface HeaderCenterProps {
  children: ReactNode;
}

/**
 * App-header center: mobile room toolbar slot + the project selector.
 * Room slot only claims space on chat room routes below `md`. The selector
 * starts at `md`: below it the header's scope chip stands in, so it never sits
 * beside the room slot.
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
        data-testid="header-scope"
        className="hidden min-w-0 flex-1 flex-row items-center gap-2 md:flex"
      >
        {children}
      </div>
    </>
  );
}
