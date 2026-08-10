"use client";

import { useSearchParams } from "next/navigation";

import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { ChatOnboardingPageSkeleton } from "@/app/chat/components/chat-onboarding-loading-view";

/**
 * Picks Instant Nav shell from `/chat` search: `?welcome=1` → onboarding
 * (all breakpoints); bare home → chats list on mobile + onboarding on desktop.
 */
export function ChatHomeLoadingBySearch(): React.ReactElement {
  const searchParams = useSearchParams();
  const isOnboardingHost = searchParams.get("welcome") === "1";

  if (isOnboardingHost) {
    return (
      <ChatOnboardingPageSkeleton data-testid="chat-home-loading-onboarding" />
    );
  }

  return (
    <>
      <ChatChatsPageSkeleton />
      <ChatOnboardingPageSkeleton
        data-testid="chat-home-loading-desktop"
        className="hidden md:flex"
      />
    </>
  );
}
