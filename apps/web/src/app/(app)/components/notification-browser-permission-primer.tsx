"use client";

import { BellRing } from "lucide-react";
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

interface NotificationBrowserPermissionPrimerProps {
  className?: string;
  variant?: "menu" | "page";
}

export function NotificationBrowserPermissionPrimer({
  className,
  variant = "menu",
}: NotificationBrowserPermissionPrimerProps) {
  const t = useTranslations("Components.NotificationCenter");
  const [permission, setPermission] =
    useState<BrowserNotificationPermission | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

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

  if (permission === "denied") {
    return (
      <div
        className={cn(
          "border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3",
          variant === "page" &&
            "sm:flex-row sm:items-center sm:justify-between",
          className,
        )}
      >
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

  const handleEnable = () => {
    if (isRequesting) {
      return;
    }

    setIsRequesting(true);
    void requestBrowserNotificationPermission()
      .then((nextPermission) => {
        setPermission(nextPermission);
      })
      .finally(() => {
        setIsRequesting(false);
      });
  };

  return (
    <div
      className={cn(
        "border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3",
        variant === "page" && "sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
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
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 self-start sm:self-center"
        onPointerDown={(event) => {
          // Keep the notification dropdown open while the OS permission dialog runs.
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
    </div>
  );
}
