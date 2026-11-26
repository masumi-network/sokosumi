"use client";

import type { ReactNode } from "react";
import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

interface HeaderCenterProps {
  children: ReactNode;
}

/**
 * The phone's global Search and New task. A chat room gives this row to its
 * own title, room search and menu, so they stay off there: at 375px they left
 * the room's name two letters. Back to chats is one tap to both.
 */
export function HeaderMobileActions({ children }: HeaderCenterProps) {
  const pathname = useChromePathname();
  if (isChatRoomPathname(pathname)) return null;
  return <div className="flex items-center gap-1 md:hidden">{children}</div>;
}

/**
 * App-header center: mobile room toolbar slot + the project selector.
 * Room slot only claims space on chat room routes below `md`. The selector
 * starts at `md`: below it the header's scope chip stands in, so it never sits
 * beside the room slot.
 */
export function HeaderCenter({ children }: HeaderCenterProps) {
  const pathname = useChromePathname();
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
