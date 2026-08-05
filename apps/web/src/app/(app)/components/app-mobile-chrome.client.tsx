"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { ChatMobileBottomNav } from "@/app/chat/components/chat-mobile-bottom-nav";
import { chatMobileTabBarClearance } from "@/app/chat/components/chat-mobile-tab-registry";
import { shouldShowMobileBottomNav } from "@/app/components/mobile-app-chrome";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

/**
 * App-wide mobile chrome: Home/Chats/Search tab bar + content clearance.
 * Visible on chat shell (except rooms) and main Home-hub list routes.
 */
export function AppMobileChrome({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const showBottomNav = shouldShowMobileBottomNav(usePathname());
  const isApple = useIsApplePlatform();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          showBottomNav && chatMobileTabBarClearance(isApple),
          showBottomNav && "md:pb-0",
        )}
      >
        {children}
      </div>
      {showBottomNav ? (
        <Suspense fallback={null}>
          <ChatMobileBottomNav />
        </Suspense>
      ) : null}
    </div>
  );
}
