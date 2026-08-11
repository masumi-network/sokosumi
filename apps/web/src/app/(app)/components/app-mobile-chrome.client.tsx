"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ChatMobileBottomNav } from "@/app/chat/components/chat-mobile-bottom-nav";
import { chatMobileTabBarClearance } from "@/app/chat/components/chat-mobile-tab-registry";
import { ChatOnboardingFab } from "@/app/chat/components/chat-onboarding-fab";
import { shouldShowMobileBottomNav } from "@/app/components/mobile-app-chrome";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

/**
 * App-wide mobile chrome: Home/Chats/Search tab bar + content clearance.
 * Visible on chat shell (except rooms/drafts) and main Home-hub list routes.
 *
 * Clearance is an in-flow spacer under `{children}` so main's overflow scroll
 * can reach past the last content item (padding on a height-locked flex child
 * does not).
 */
export function AppMobileChrome({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/*
        No min-h-0 here: list routes must grow this column so the spacer
        below sits after the last item in main's scroll overflow. Chat shells
        use an explicit height + their own min-h-0 chain for inner scroll.
      */}
      <div className="flex flex-1 flex-col">{children}</div>
      <Suspense fallback={null}>
        <AppMobileBottomChrome />
      </Suspense>
    </div>
  );
}

function AppMobileBottomChrome(): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showBottomNav = shouldShowMobileBottomNav(pathname, searchParams);
  const isApple = useIsApplePlatform();

  if (!showBottomNav) {
    return null;
  }

  return (
    <>
      <div
        aria-hidden
        data-mobile-bottom-nav-spacer
        className={cn(
          "pointer-events-none shrink-0 md:hidden",
          chatMobileTabBarClearance(isApple),
        )}
      />
      <Suspense fallback={null}>
        <ChatMobileBottomNav />
      </Suspense>
      <Suspense fallback={null}>
        <ChatOnboardingFab />
      </Suspense>
    </>
  );
}
