import type { Viewport } from "next";

import { APP_VIEWPORT_BASE } from "@/lib/app-viewport";

/**
 * Studio replaces the root viewport export for this segment.
 * `resizes-content` lifts the composer above the soft keyboard, same as chat.
 */
export const viewport: Viewport = {
  ...APP_VIEWPORT_BASE,
  interactiveWidget: "resizes-content",
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
