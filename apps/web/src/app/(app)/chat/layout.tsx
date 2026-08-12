import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";

import { APP_VIEWPORT_BASE } from "@/lib/app-viewport";

import { ChatRouteErrorBoundary } from "./components/chat-route-error-boundary.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Chat replaces the root viewport export. Spreads `APP_VIEWPORT_BASE`
 * (fit cover + maximumScale 1). `resizes-content` lifts the room composer
 * above the soft keyboard.
 */
export const viewport: Viewport = {
  ...APP_VIEWPORT_BASE,
  interactiveWidget: "resizes-content",
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
