"use client";

import { useEffect } from "react";

/**
 * Toggles `data-hermes-fullscreen="true"` on `<body>` for the duration of
 * the Personal Assistant route. The shared breadcrumb header stays (like
 * every other route); this attribute only tells a global CSS rule to drop
 * AppLayout's `p-4` gutter so the chat/empty-state renders full-bleed in the
 * content area below the header — without the shared AppLayout having to know
 * about this surface.
 */
export default function FullscreenEffect() {
  useEffect(() => {
    document.body.dataset.hermesFullscreen = "true";
    return () => {
      delete document.body.dataset.hermesFullscreen;
    };
  }, []);
  return null;
}
