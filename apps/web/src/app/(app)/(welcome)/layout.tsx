import type { Viewport } from "next";

import { ChatRouteErrorBoundary } from "@/app/chat/components/chat-route-error-boundary.client";
import { APP_VIEWPORT_BASE } from "@/lib/app-viewport";

/**
 * Welcome replaces the root viewport export. Spreads `APP_VIEWPORT_BASE`
 * (fit cover + maximumScale 1). `resizes-content` lifts draft composers
 * above the soft keyboard (same as chat rooms).
 */
export const viewport: Viewport = {
  ...APP_VIEWPORT_BASE,
  interactiveWidget: "resizes-content",
};

export default function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Bottom nav lives in AppMobileChrome (app frame). Page boundary only here
  // so Instant Navigations can still validate if page chrome throws.
  return <ChatRouteErrorBoundary>{children}</ChatRouteErrorBoundary>;
}
