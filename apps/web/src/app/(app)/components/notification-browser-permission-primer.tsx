"use client";

import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  getPushRepairOutcome,
  getServerPushRepairOutcome,
  recordPushRepairOutcome,
  subscribePushRepairOutcome,
} from "@/lib/ably/push-repair-outcome.client";
import { getPushTeardownVersion } from "@/lib/ably/push-work-queue.client";
import { useSession } from "@/lib/auth/auth.client";
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
import { getMyPreferencesQueryOptions } from "@/queries/preferences";
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
  variant?: "panel" | "page";
  /** Closes the surrounding panel, which navigation does not unmount. */
  onNavigate?: () => void;
}

export function NotificationBrowserPermissionPrimer({
  className,
  variant = "panel",
  onNavigate,
}: NotificationBrowserPermissionPrimerProps) {
  const t = useTranslations("Components.NotificationCenter");
  const [permission, setPermission] =
    useState<BrowserNotificationPermission | null>(null);
  const [capability, setCapability] = useState<PrimerCapability>("none");
  const [isRequesting, setIsRequesting] = useState(false);
  const { data: session } = useSession();
  /**
   * What the app-open repair left this browser in. An external store rather
   * than a read of this browser here: the repair runs once per reader in the
   * notification provider, and a card that read the subscription for itself
   * would answer while that repair was still in flight and say push is off on
   * every browser it is about to fix.
   */
  const repairOutcome = useSyncExternalStore(
    subscribePushRepairOutcome,
    getPushRepairOutcome,
    getServerPushRepairOutcome,
  );
  const sessionUserId = session?.user.id;
  const { data: preferences } = useQuery({
    ...getMyPreferencesQueryOptions(sessionUserId),
    enabled: Boolean(sessionUserId) && repairOutcome === "quiet",
  });
  const pushWanted =
    preferences?.data.pushOptIn === true &&
    preferences.data.notificationPreferences.some(
      (cell) => cell.channel === "OS_BANNER" && cell.enabled,
    );

  /**
   * Subscribes this browser again, from wherever the reader met the card.
   *
   * The permission is already granted in the state this runs in, so there is
   * no prompt and no gesture to preserve: the one press is the whole of it.
   * The outcome is read again when it settles, so a repair that fails leaves
   * the card where it was rather than reporting a success it did not get.
   */
  const handleRestorePush = () => {
    if (isRequesting || !sessionUserId) {
      return;
    }

    const teardownVersion = getPushTeardownVersion();
    setIsRequesting(true);
    // Loaded on the press that needs it. The Ably SDK stays off the app shell
    // for every reader whose browser is not quiet, the same boundary the
    // account page and the app-open repair keep.
    void import("@/lib/ably/push-activation.client")
      .then(({ activatePush }) => {
        if (getPushTeardownVersion() !== teardownVersion) {
          return false;
        }
        return activatePush(sessionUserId);
      })
      .catch((error: unknown) => {
        console.error("Failed to restore the push subscription", error);
      })
      .finally(() =>
        // This card is only drawn for a browser Ably held a registration for,
        // so the press knows that without reading it again. It has to: the
        // activation clears that registration halfway through its round, and
        // a failed press that read it afterwards would find none, record this
        // browser as healthy, and take the card away as though the press had
        // worked.
        //
        // The press is not over until this lands. Releasing the button first
        // leaves it live over a card that still says push is off, so a reader
        // who presses again starts a second activation against the answer of
        // the first. Its own failure is caught rather than left to reject into
        // nothing, and the button comes back either way: a reader whose
        // browser could not be written down still gets to try again.
        recordPushRepairOutcome({
          hadRegistration: true,
          teardownVersion,
        })
          .catch((error: unknown) => {
            console.error("Failed to record the push repair outcome", error);
          })
          .finally(() => {
            setIsRequesting(false);
          }),
      );
  };

  useMountEffect(() => {
    // Both reads need `window`, and they land together, so the `permission`
    // gate below covers the render before either has an answer.
    setPermission(getBrowserNotificationPermission());
    setCapability(readCapability());
    return subscribeBrowserNotificationPermission(setPermission);
  });

  if (
    permission === null ||
    permission === "unsupported" ||
    // Nothing here can show a banner, so there is nothing to offer or explain.
    capability === "none"
  ) {
    return null;
  }

  const cardClassName = cn(
    "border-border bg-card-background flex flex-col gap-2 rounded-md border p-3",
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

  /**
   * A browser the reader set up for push, that stopped receiving it.
   *
   * With the permission granted there is nothing left to ask for, so this is
   * the only thing this card has to say to such a reader, and it says it only
   * when the app-open repair has already tried and failed. A browser that
   * never turned push on has no registration to repair from and reads as
   * `healthy` here, which is what keeps this from nagging a reader who wants
   * push on their phone alone.
   */
  if (permission === "granted") {
    if (repairOutcome !== "quiet" || !sessionUserId || !pushWanted) {
      return null;
    }

    return card({
      title: t("pushQuietTitle"),
      description: t("pushQuietDescription"),
      action: (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 self-start sm:self-center"
          onPointerDown={(event) => {
            // Keep the panel open while the subscription is being restored.
            if (variant === "panel") {
              event.preventDefault();
            }
          }}
          onClick={handleRestorePush}
          disabled={isRequesting}
        >
          {isRequesting ? t("pushQuietRestoring") : t("pushQuietRestore")}
        </Button>
      ),
    });
  }

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
            // Keep the panel open while the OS permission dialog runs.
            if (variant === "panel") {
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
