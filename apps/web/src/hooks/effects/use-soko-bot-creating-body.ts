"use client";

import { useEffect } from "react";

/**
 * Toggles `data-soko-bot-creating="true"` on `<body>` while the Soko Bot
 * creation flow is mounted so the mobile tab bar stays hidden.
 */
export function useSokoBotCreatingBody(): void {
  useEffect(() => {
    document.body.dataset.sokoBotCreating = "true";
    return () => {
      delete document.body.dataset.sokoBotCreating;
    };
  }, []);
}
