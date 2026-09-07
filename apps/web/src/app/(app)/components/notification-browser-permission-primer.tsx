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
import {
  isPushSupported,
  isServiceWorkerSupported,
} from "@/lib/utils/notification-service-worker";
import { NOTIFICATION_PREFERENCES_HREF } from "../account/constants";

/**
 * The most this browser can do, which decides what the card offers.
 *
 * `push` links to the settings. `in-app` asks for the permission here,
 * because the account page cannot subscribe this browser and the
 * permission still buys the banners the app renders while a tab is open.
 * `none` has no worker to render through, and ADR-0023 makes that
 * registration the only renderer, so the card offers nothing rather than a
 * permission that would show no banner.
 */
type PrimerCapability = "push" | "in-app" | "none";

function readCapability(): PrimerCapability {
  if (isPushSupported()) {
    return "push";
  }

  return isServiceWorkerSupported() ? "in-app" : "none";
}

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
  const [capability, setCapability] = useState<PrimerCapability>("none");
  const [isRequesting, setIsRequesting] = useState(false);

  useMountEffect(() => {
    // Both reads need `window`, and they land together, so the `permission`
    // gate below covers the render before either has an answer.
    setPermission(getBrowserNotificationPermission());
    setCapability(readCapability());
    return subscribeBrowserNotificationPermission(setPermission);
  });

  if (
    permission === null ||
    permission === "granted" ||
    permission === "unsupported" ||
    // Nothing here can show a banner, so there is nothing to offer or explain.
    capability === "none"
  ) {
    return null;
  }

  const cardClassName = cn(
    "border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3",
    variant === "page" && "sm:flex-row sm:items-center sm:justify-between",
    className,
  );

  const card = ({
    title,
    description,
    action,
  }: {
    title: string;
    description: string;
    action?: React.ReactNode;
  }) => (
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
    return card({
      title: t("browserPermissionDeniedTitle"),
      description: t("browserPermissionDeniedDescription"),
    });
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
  // Push cells would record consent that reaches their other devices and
  // leave this browser silent. The permission is the one thing that still
  // works here, and it buys the banners this app renders while a tab is open.
  if (capability === "in-app") {
    return card({
      title: t("browserPermissionInAppTitle"),
      description: t("browserPermissionInAppDescription"),
      action: (
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
        </Button>
      ),
    });
  }

  return card({
    title: t("browserPermissionTitle"),
    description: t("browserPermissionDescription"),
    action: (
      <Button
        asChild
        size="sm"
        variant="outline"
        className="shrink-0 self-start sm:self-center"
      >
        <Link href={NOTIFICATION_PREFERENCES_HREF} onClick={onNavigate}>
          {t("browserPermissionOpenSettings")}
        </Link>
      </Button>
    ),
  });
}
