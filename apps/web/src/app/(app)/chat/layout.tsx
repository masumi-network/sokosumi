import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./components/chat-error-fallback";
import { ChatMobileBottomNav } from "./components/chat-mobile-bottom-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the room composer stays above the keyboard.
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DefaultErrorBoundary fallback={<ChatErrorFallback />}>
      <div className="flex min-h-0 flex-1 flex-col pb-0 md:pb-0">
        {children}
        <div className="h-16 shrink-0 md:hidden" aria-hidden />
        <ChatMobileBottomNav />
      </div>
    </DefaultErrorBoundary>
  );
}
