"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";
import {
  type BrowserNotificationPermission,
  getBrowserNotificationPermission,
  subscribeBrowserNotificationPermission,
} from "@/lib/utils/browser-notification";

/**
 * Where the reader turns push on. The card hands them here rather than asking
 * for the permission itself: a bare permission only buys banners while a tab
 * is open, and the reader who clicked "enable notifications" would still hear
 * nothing once they closed the app. The account page runs the whole gesture,
 * permission included.
 *
 * The trade is one hop for the reader, and nothing at all for a browser that
 * supports the Notification API but not push: the account page cannot
 * subscribe there, so it never asks for the permission that would have given
 * them in-app banners. SOK-876 folds permission, activation, and opt-in into
 * this card and closes that.
 */
const PUSH_SETTINGS_HREF = "/account#notification-preferences";

interface NotificationBrowserPermissionPrimerProps {
  className?: string;
  variant?: "menu" | "page";
  /** Closes the surrounding dropdown, which navigation does not unmount. */
  onNavigate?: () => void;
}

export function NotificationBrowserPermissionPrimer({
  className,
  variant = "menu",
  onNavigate,
}: NotificationBrowserPermissionPrimerProps) {
  const t = useTranslations("Components.NotificationCenter");
  const [permission, setPermission] =
    useState<BrowserNotificationPermission | null>(null);

  useMountEffect(() => {
    setPermission(getBrowserNotificationPermission());
    return subscribeBrowserNotificationPermission(setPermission);
  });

  if (
    permission === null ||
    permission === "granted" ||
    permission === "unsupported"
  ) {
    return null;
  }

  const cardClassName = cn(
    "border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3",
    variant === "page" && "sm:flex-row sm:items-center sm:justify-between",
    className,
  );

  // The account page cannot lift a block either, so this state gets no link:
  // only the browser's own settings can, and the copy says so.
  if (permission === "denied") {
    return (
      <div className={cardClassName}>
        <div className="flex min-w-0 items-start gap-2">
          <BellRing className="text-primary mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm leading-snug font-medium">
              {t("browserPermissionDeniedTitle")}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("browserPermissionDeniedDescription")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClassName}>
      <div className="flex min-w-0 items-start gap-2">
        <BellRing className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm leading-snug font-medium">
            {t("browserPermissionTitle")}
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("browserPermissionDescription")}
          </p>
        </div>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="shrink-0 self-start sm:self-center"
      >
        <Link href={PUSH_SETTINGS_HREF} onClick={onNavigate}>
          {t("browserPermissionOpenSettings")}
        </Link>
      </Button>
    </div>
  );
}
