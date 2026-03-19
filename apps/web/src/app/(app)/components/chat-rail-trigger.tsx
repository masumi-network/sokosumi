"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAppChatRail } from "@/contexts/app-chat-rail-context";

export default function ChatRailTrigger() {
  const t = useTranslations("App.ChatRail");
  const { toggleRail } = useAppChatRail();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleRail}
      className="gap-2"
      aria-label={t("chat")}
      data-chat-rail-trigger-anchor
    >
      <MessageSquare className="size-4" aria-hidden />
      <span className="hidden sm:inline">{t("chat")}</span>
    </Button>
  );
}
