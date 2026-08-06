"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { chatMobileTabBarBottomOffset } from "@/app/chat/components/chat-mobile-tab-registry";
import { cn } from "@/lib/utils";

import { MOBILE_TAB_PENDING_OVERLAY_DELAY_MS } from "./mobile-tab-pending-overlay-delay";

/** Stacking: below ChatMobileBottomNav (z-40) and create FAB (z-50). */
export const MOBILE_TAB_PENDING_OVERLAY_Z_CLASS = "z-30" as const;

export interface MobileTabLinkPendingOverlayProps {
  /** Drives bottom inset via chatMobileTabBarBottomOffset(isApple). */
  isApple: boolean;
}

export interface MainContentPendingOverlayProps {
  /** When true, layer mounts with CSS-delayed fade-in. */
  visible: boolean;
  /** Full static Tailwind bottom offset class (docked vs Apple float). */
  bottomOffsetClass: string;
  className?: string;
}

/**
 * MUST render as a descendant of next/link `Link`.
 * Reads useLinkStatus().pending; after ≥300ms pending, fades in
 * MainContentPendingOverlay over the main content band only.
 */
export function MobileTabLinkPendingOverlay({
  isApple,
}: MobileTabLinkPendingOverlayProps): React.ReactElement | null {
  const { pending } = useLinkStatus();

  return (
    <MainContentPendingOverlay
      visible={pending}
      bottomOffsetClass={chatMobileTabBarBottomOffset(isApple)}
    />
  );
}

/**
 * Fixed overlay covering main content only: below app Header (h-16 / top-16),
 * above tab-bar clearance, md:hidden, z-30. Dimmed backdrop (bg-background/50)
 * + Loader2. Portaled to document.body so the sr-only label does not pollute
 * the parent Link name.
 */
export function MainContentPendingOverlay({
  visible,
  bottomOffsetClass,
  className,
}: MainContentPendingOverlayProps): React.ReactElement | null {
  const t = useTranslations("App.Channels.MobileNav");

  if (!visible || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-mobile-tab-pending-overlay
      className={cn(
        "pointer-events-none fixed inset-x-0 top-16 flex items-center justify-center md:hidden",
        "bg-background/50",
        MOBILE_TAB_PENDING_OVERLAY_Z_CLASS,
        "animate-mobile-tab-pending-fade-in opacity-0",
        bottomOffsetClass,
        className,
      )}
      style={{
        animationDelay: `${MOBILE_TAB_PENDING_OVERLAY_DELAY_MS}ms`,
      }}
    >
      <Loader2 className="size-8 animate-spin" aria-hidden />
      <span className="sr-only">{t("loading")}</span>
    </div>,
    document.body,
  );
}
