"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { CHAT_WELCOME_PATH } from "@/app/chat/utils/chat-route-base";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";

/**
 * Desktop has no chats-list page (sidebar owns DMs/channels). Bare `/chat`
 * on `md+` replaces to Welcome. Mobile keeps the list. Mount only when the
 * list page is actually rendering (draft/notice already redirected server-side).
 */
export function ChatDesktopHomeRedirect(): null {
  const router = useRouter();
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);

    function tryRedirect(matches: boolean) {
      if (!matches || hasRedirectedRef.current) {
        return;
      }
      hasRedirectedRef.current = true;
      router.replace(CHAT_WELCOME_PATH);
    }

    function handleViewportChange(event: MediaQueryListEvent) {
      tryRedirect(event.matches);
    }

    tryRedirect(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => {
        mediaQuery.removeEventListener("change", handleViewportChange);
      };
    }

    mediaQuery.addListener(handleViewportChange);
    return () => {
      mediaQuery.removeListener(handleViewportChange);
    };
  }, [router]);

  return null;
}
