import { Suspense } from "react";

import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { ChatHomeLoadingBySearch } from "@/app/chat/components/chat-home-loading-view.client";
import { ChatOnboardingPageSkeleton } from "@/app/chat/components/chat-onboarding-loading-view";

/**
 * Bare `/chat` Instant Nav split (no search yet / Suspense fallback):
 * mobile chats-list skeleton; desktop questionnaire onboarding skeleton.
 */
export function ChatHomeBarePageSkeleton(): React.ReactElement {
  return (
    <>
      <ChatChatsPageSkeleton />
      <ChatOnboardingPageSkeleton
        data-testid="chat-home-loading-desktop"
        className="hidden md:flex"
        surface="home"
      />
    </>
  );
}

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * `?welcome=1` shows onboarding on mobile too; bare home keeps chats redirect
 * skeleton on mobile.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <Suspense fallback={<ChatHomeBarePageSkeleton />}>
      <ChatHomeLoadingBySearch />
    </Suspense>
  );
}
