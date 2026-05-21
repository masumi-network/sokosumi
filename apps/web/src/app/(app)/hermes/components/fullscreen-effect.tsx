"use client";

import { useEffect } from "react";

/**
 * Toggles `data-hermes-fullscreen="true"` on `<body>` for the duration of
 * the Hermes route. AppLayout reserves 64px at the top for the breadcrumb
 * header on every route — Hermes hides that header (see Header component)
 * and needs the main element to reclaim the full viewport. A global CSS
 * rule keyed off this attribute does the height + padding override so the
 * shared AppLayout doesn't have to know about Hermes.
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
