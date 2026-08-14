"use client";

import { useTranslations } from "next-intl";

/**
 * Chrome-free Suspense fallback while workspace inventory resolves.
 * Must not render sidebar/header — AC: not-ready users never see app chrome.
 * Client-only so layout can stay sync for Instant Nav while still localizing
 * the screen-reader label.
 */
export function AppAccessCheckingFallback() {
  const t = useTranslations("App.WorkspaceAccess");

  return (
    <div
      className="flex min-h-svh flex-1 items-center justify-center"
      data-app-access-checking
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("checking")}</span>
    </div>
  );
}
