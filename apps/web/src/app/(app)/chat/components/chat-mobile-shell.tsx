"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { classifyChatChromeSurface } from "@/app/chat/utils/chat-route-base";
import { cn } from "@/lib/utils";

import { ChatMobileBottomNav } from "./chat-mobile-bottom-nav";
import { CHAT_MOBILE_TAB_BAR_CLEARANCE } from "./chat-mobile-tab-registry";

export function ChatMobileShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const surface = classifyChatChromeSurface(pathname, searchParams);
  const showBottomNav = surface !== "room";

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
