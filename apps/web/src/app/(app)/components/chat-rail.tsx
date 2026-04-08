"use client";

import { PanelRightIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import ChatInterface from "@/app/chat-ui/components/chat-interface";
import { isChatShellPathname } from "@/app/chat-ui/utils/chat-route-base";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAppChatRail } from "@/contexts/app-chat-rail-context";
import { useConversationsContext } from "@/contexts/conversations-context";
import {
  CHAT_RAIL_READY_POLL_MS,
  CHAT_RAIL_READY_TIMEOUT_MS,
} from "@/lib/constants/chat-rail-ready";

interface ChatRailProps {
  organizationSlug: string | null;
  userImageUrl: string;
  userName?: string;
}

export default function ChatRail({
  organizationSlug,
  userImageUrl,
  userName,
}: ChatRailProps) {
  const pathname = usePathname();
  const tChat = useTranslations("App.Chat.Chat");
  const tChatRail = useTranslations("App.ChatRail");
  const {
    open,
    openMobile,
    setOpenMobile,
    closeRail,
    selectedConversationId,
    setSelectedConversationId,
    isNewChat,
    openConversation,
  } = useAppChatRail();
  const { conversations } = useConversationsContext();
  const [isDesktopRailReady, setIsDesktopRailReady] = useState(false);

  const isStandaloneChat = isChatShellPathname(pathname);
  const isVisible = !isStandaloneChat && open;
  const latestConversationId = conversations[0]?.id ?? null;

  useEffect(() => {
    if (isStandaloneChat) {
      return;
    }

    if (!open && !openMobile) {
      return;
    }

    if (isNewChat) {
      return;
    }

    if (
      selectedConversationId &&
      conversations.some(
        (conversation) => conversation.id === selectedConversationId,
      )
    ) {
      return;
    }

    setSelectedConversationId(latestConversationId);
  }, [
    conversations,
    isNewChat,
    isStandaloneChat,
    latestConversationId,
    open,
    openMobile,
    selectedConversationId,
    setSelectedConversationId,
  ]);

  useEffect(() => {
    let animationFrame = 0;
    let pollTimeoutId = 0;
    let fallbackTimeoutId = 0;
    const desktopRailPanel = document.querySelector<HTMLElement>(
      "[data-chat-rail-panel]",
    );

    const scheduleRailReadyUpdate = (isReady: boolean) => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setIsDesktopRailReady(isReady);
      });
    };

    function clearFallbackTimeout() {
      if (fallbackTimeoutId) {
        window.clearTimeout(fallbackTimeoutId);
        fallbackTimeoutId = 0;
      }
    }

    if (!isVisible) {
      scheduleRailReadyUpdate(false);
      return () => {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
      };
    }

    const isChatInputMounted = () =>
      Boolean(
        document.querySelector<HTMLElement>(
          "[data-chat-input-border-anchor]",
        ) ??
          document.querySelector<HTMLElement>(
            "[data-testid='multimodal-input']",
          ),
      );

    const isPanelFullyOpen = () => {
      if (!desktopRailPanel) return true;
      return (
        desktopRailPanel.getBoundingClientRect().right <= window.innerWidth + 1
      );
    };

    const syncRailReadyState = () => {
      const ready = isPanelFullyOpen() && isChatInputMounted();
      if (ready) clearFallbackTimeout();
      scheduleRailReadyUpdate(ready);
    };

    const pollRailReadyState = () => {
      if (isPanelFullyOpen() && isChatInputMounted()) {
        clearFallbackTimeout();
        scheduleRailReadyUpdate(true);
        return;
      }

      pollTimeoutId = window.setTimeout(
        pollRailReadyState,
        CHAT_RAIL_READY_POLL_MS,
      );
    };

    fallbackTimeoutId = window.setTimeout(() => {
      fallbackTimeoutId = 0;
      if (pollTimeoutId) {
        window.clearTimeout(pollTimeoutId);
        pollTimeoutId = 0;
      }
      scheduleRailReadyUpdate(true);
    }, CHAT_RAIL_READY_TIMEOUT_MS);

    pollRailReadyState();

    desktopRailPanel?.addEventListener("transitionend", syncRailReadyState);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      clearFallbackTimeout();
      desktopRailPanel?.removeEventListener(
        "transitionend",
        syncRailReadyState,
      );
    };
  }, [isVisible, conversations.length, isNewChat, selectedConversationId]);

  if (isStandaloneChat) {
    return null;
  }

  const railBody = (
    <div
      className="bg-background flex h-full min-h-0 w-full flex-col"
      data-chat-rail-anchor
    >
      <div className="border-border flex h-16 items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium">{tChatRail("chat")}</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={closeRail}
            aria-label={tChat("deleteDialog.cancel")}
            title={tChat("deleteDialog.cancel")}
          >
            <PanelRightIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:p-4">
        <ChatInterface
          navigationMode="controlled"
          controlledConversationId={isNewChat ? null : selectedConversationId}
          onConversationCreated={openConversation}
          organizationSlug={organizationSlug}
          userImageUrl={userImageUrl}
          userName={userName}
          showGreetingAndSuggestions={false}
        />
      </div>
    </div>
  );

  return (
    <>
      <div
        aria-hidden
        className="hidden transition-[width] duration-200 ease-linear md:block"
        style={{
          width: isVisible ? "clamp(24rem, 46vw, 30rem)" : "0px",
        }}
      />

      <div
        className="border-border bg-background fixed top-0 right-0 bottom-0 z-40 hidden border-l shadow-sm transition-transform duration-200 ease-linear md:flex"
        data-chat-rail-panel="true"
        data-chat-rail-open={isVisible ? "true" : "false"}
        data-chat-rail-ready={isDesktopRailReady ? "true" : "false"}
        style={{
          width: "clamp(24rem, 46vw, 30rem)",
          transform: isVisible ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {railBody}
      </div>

      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetHeader className="sr-only">
          <SheetTitle>{tChatRail("chat")}</SheetTitle>
          <SheetDescription>{tChatRail("chat")}</SheetDescription>
        </SheetHeader>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full max-w-none gap-0 border-l p-0 sm:max-w-3xl"
        >
          {railBody}
        </SheetContent>
      </Sheet>
    </>
  );
}
