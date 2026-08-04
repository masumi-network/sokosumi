import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./components/chat-error-fallback";

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the room composer stays above the keyboard.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

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
      {children}
    </DefaultErrorBoundary>
  );
}
