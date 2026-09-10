"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ChatMobileBottomNav } from "@/app/chat/components/chat-mobile-bottom-nav";
import { chatMobileTabBarClearance } from "@/app/chat/components/chat-mobile-tab-registry";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { shouldShowMobileBottomNav } from "@/app/components/mobile-app-chrome";
import { ChatControlListBridge } from "@/components/chat/chat-control-list-bridge";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

/**
 * App-wide mobile chrome: Home/Chats/You tab bar + content clearance.
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

  const { showUnreadDot, unreadRoomCount } = useChatTabUnreadPresence();
  const { data: session } = useSession();
  useChatUnreadDocumentTitle(unreadRoomCount);

  return (
    <>
      {/* Keep unread reads and control events alive when mobile navigation is hidden. */}
      {session?.user ? (
        <LazyAblyProvider>
          <ChatControlListBridge currentUserId={session.user.id} />
        </LazyAblyProvider>
      ) : null}
      {showBottomNav ? (
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
            <ChatMobileBottomNav showUnreadDot={showUnreadDot} />
          </Suspense>
        </>
      ) : null}
    </>
  );
}
