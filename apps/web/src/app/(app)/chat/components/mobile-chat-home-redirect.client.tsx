"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useIsMobileMedia } from "@/hooks/use-mobile";

/**
 * Mobile `<md` bare `/chat` (surface home) → `/chat/chats`.
 * Desktop keeps ChatWelcomeClient on `/chat`.
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

  if (isMobile !== true) {
    return null;
  }

  return (
    <div
      data-testid="mobile-chat-home-redirect"
      className="md:hidden"
      aria-hidden
    />
  );
}
