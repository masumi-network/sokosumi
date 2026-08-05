import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ChatRouteErrorBoundary } from "./components/chat-route-error-boundary.client";

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
  // Bottom nav lives in AppMobileChrome (app frame). Page boundary only here
  // so Instant Navigations can still validate if page chrome throws.
  return <ChatRouteErrorBoundary>{children}</ChatRouteErrorBoundary>;
}
