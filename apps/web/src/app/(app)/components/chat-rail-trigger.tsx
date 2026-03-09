"use client";

import { MessageSquare } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAppChatRail } from "@/contexts/app-chat-rail-context";

export default function ChatRailTrigger() {
  const t = useTranslations("App.ChatRail");
  const pathname = usePathname();
  const { open, openMobile, isMobile, toggleRail } = useAppChatRail();
  const isActive = isMobile ? openMobile : open;

  if (pathname.startsWith("/chat") || isActive) {
    return null;
  }

  return (
    <Button
      variant={isActive ? "secondary" : "ghost"}
      size="sm"
      onClick={toggleRail}
      className="gap-2"
      aria-pressed={isActive}
      aria-label={t("chat")}
    >
      <MessageSquare className="size-4" aria-hidden />
      <span className="hidden sm:inline">{t("chat")}</span>
    </Button>
  );
}
