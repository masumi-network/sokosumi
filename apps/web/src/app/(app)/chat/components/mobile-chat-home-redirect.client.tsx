"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { useIsMobileMedia } from "@/hooks/use-mobile";

/**
 * Mobile `<md` bare `/chat` (surface home) → `/chat/chats`.
 * Desktop keeps the welcome landing on `/chat`.
 *
 * While the media query is unresolved or mobile, show the chats skeleton so
 * the Instant Nav / streamed landing is not a blank main area.
 */
export function MobileChatHomeRedirect(): React.ReactElement | null {
  const router = useRouter();
  const isMobile = useIsMobileMedia();

  useEffect(() => {
    if (isMobile !== true) {
      return;
    }
    router.replace("/chat/chats");
  }, [isMobile, router]);

  if (isMobile === false) {
    return null;
  }

  return <ChatChatsPageSkeleton />;
}
