import type { Metadata, Viewport } from "next";
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
 * Chat replaces the root viewport export — keep device-width + viewport-fit
 * so iOS `env(safe-area-inset-*)` still applies. `resizes-content` lifts the
 * room composer above the soft keyboard.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
