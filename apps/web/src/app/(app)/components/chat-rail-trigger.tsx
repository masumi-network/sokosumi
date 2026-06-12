"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAppChatRail } from "@/contexts/app-chat-rail-context";

export default function ChatRailTrigger() {
  const t = useTranslations("App.ChatRail");
  const { closeRail, isMobile, open, openMobile, openNewChat } =
    useAppChatRail();

  function handleClick() {
    const isRailOpen = isMobile ? openMobile : open;
    if (isRailOpen) {
      closeRail();
      return;
    }

    openNewChat();
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleClick}
      className="size-8 shrink-0 rounded-full"
      aria-label={t("chat")}
      data-chat-rail-trigger-anchor
    >
      <MessageSquare className="size-4" aria-hidden />
    </Button>
  );
}
