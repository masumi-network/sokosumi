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
  requestBrowserNotificationPermission,
  subscribeBrowserNotificationPermission,
} from "@/lib/utils/browser-notification";
import { isPushSupported } from "@/lib/utils/notification-service-worker";

/**
 * Where the reader turns push on. The card hands them here rather than asking
 * for the permission itself: a bare permission only buys banners while a tab
 * is open, and the reader who clicked "enable notifications" would still hear
 * nothing once they closed the app. The account page runs the whole gesture,
 * permission included.
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
  const [canPushHere, setCanPushHere] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  useMountEffect(() => {
    // Both reads need `window`, and they land together, so the `permission`
    // gate below covers the render before either has an answer.
    setPermission(getBrowserNotificationPermission());
    setCanPushHere(isPushSupported());
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

  const card = (
    title: string,
    description: string,
    action: React.ReactNode,
  ) => (
    <div className={cardClassName}>
      <div className="flex min-w-0 items-start gap-2">
        <BellRing className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm leading-snug font-medium">{title}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );

  // The account page cannot lift a block either, so this state gets no link
  // to it: only the browser's own settings can, and the copy says so.
  if (permission === "denied") {
    return card(
      t("browserPermissionDeniedTitle"),
      t("browserPermissionDeniedDescription"),
      null,
    );
  }

  const handleEnable = () => {
    if (isRequesting) {
      return;
    }

    setIsRequesting(true);
    void requestBrowserNotificationPermission()
      .then(setPermission)
      .finally(() => {
        setIsRequesting(false);
      });
  };

  // No push here, so the settings page has nothing to offer this reader: its
  // switch would record account consent that reaches their other devices and
  // leave this browser silent. The permission is the one thing that still
  // works here, and it buys the banners this app renders while a tab is open.
  if (!canPushHere) {
    return card(
      t("browserPermissionInAppTitle"),
      t("browserPermissionInAppDescription"),
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 self-start sm:self-center"
        onPointerDown={(event) => {
          // Keep the dropdown open while the OS permission dialog runs.
          if (variant === "menu") {
            event.preventDefault();
          }
        }}
        onClick={handleEnable}
        disabled={isRequesting}
      >
        {isRequesting
          ? t("browserPermissionRequesting")
          : t("browserPermissionEnable")}
      </Button>,
    );
  }

  return card(
    t("browserPermissionTitle"),
    t("browserPermissionDescription"),
    <Button
      asChild
      size="sm"
      variant="outline"
      className="shrink-0 self-start sm:self-center"
    >
      <Link href={PUSH_SETTINGS_HREF} onClick={onNavigate}>
        {t("browserPermissionOpenSettings")}
      </Link>
    </Button>,
  );
}
