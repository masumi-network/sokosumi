"use client";

import { usePathname } from "next/navigation";

import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

import { ChatMobileBottomNav } from "./chat-mobile-bottom-nav";
import { CHAT_MOBILE_TAB_BAR_CLEARANCE } from "./chat-mobile-tab-registry";

export function ChatMobileShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // Room path alone gates the tab bar; drafts share `/chat` and keep the nav.
  const showBottomNav = !isChatRoomPathname(usePathname());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          showBottomNav && CHAT_MOBILE_TAB_BAR_CLEARANCE,
          showBottomNav && "md:pb-0",
        )}
      >
        {children}
      </div>
      {showBottomNav ? <ChatMobileBottomNav /> : null}
    </div>
  );
}
