"use client";

import { usePathname } from "next/navigation";

import { useAppChatRail } from "@/contexts/app-chat-rail-context";

interface HeaderUserSectionProps {
  children: React.ReactNode;
}

export default function HeaderUserSection({
  children,
}: HeaderUserSectionProps) {
  const pathname = usePathname();
  const { open, openMobile } = useAppChatRail();
  const isChatOpen = open || openMobile;
  const isOnChatPage = pathname?.startsWith("/chat") ?? false;

  if (isChatOpen || isOnChatPage) return null;
  return <>{children}</>;
}
