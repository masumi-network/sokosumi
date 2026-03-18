"use client";

import { MessageSquarePlus, PanelRightIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import ChatInterface from "@/app/chat/components/chat-interface";
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
    openNewChat,
    openConversation,
  } = useAppChatRail();
  const { conversations } = useConversationsContext();

  const isStandaloneChat = pathname.startsWith("/chat");
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

  if (isStandaloneChat) {
    return null;
  }

  const railBody = (
    <div
      className="bg-background flex h-full min-h-0 w-full flex-col"
      data-chat-rail-anchor
    >
      <div className="border-border flex h-16 items-center justify-end border-b px-4 py-3">
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={openNewChat}
          >
            <MessageSquarePlus className="size-4" aria-hidden />
            <span className="hidden lg:inline">{tChat("newChat")}</span>
          </Button>
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
