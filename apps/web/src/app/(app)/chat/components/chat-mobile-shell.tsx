"use client";

import { cn } from "@/lib/utils";

import { ChatMobileBottomNav } from "./chat-mobile-bottom-nav";
import { CHAT_MOBILE_TAB_BAR_CLEARANCE } from "./chat-mobile-tab-registry";

export function ChatMobileShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          CHAT_MOBILE_TAB_BAR_CLEARANCE,
          "md:pb-0",
        )}
      >
        {children}
      </div>
      <ChatMobileBottomNav />
    </div>
  );
}
