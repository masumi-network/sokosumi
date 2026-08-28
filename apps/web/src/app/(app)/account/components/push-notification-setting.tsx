"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { usePushPreference } from "@/lib/ably/use-push-preference";
import { useSession } from "@/lib/auth/auth.client";

/**
 * The push rows of the notification card. They sit apart from the email rows
 * because they change for different reasons: those write through Better Auth,
 * these drive Ably and the Core preferences endpoint.
 *
 * Two rows, not one. Account-wide consent and this browser's subscription are
 * independent, and a single switch could not say which one the reader meant.
 * The account row also stays reachable from a browser that holds no
 * subscription, which is the state one switch could never turn off.
 */
export function PushNotificationSetting() {
  const t = useTranslations("App.Account.Notifications");
  const tCenter = useTranslations("Components.NotificationCenter");
  const { data: session } = useSession();
  const push = usePushPreference(session?.user.id);
  const accountDescriptionId = useId();
  const deviceDescriptionId = useId();

  // A blocked browser fails every subscribe, so name the block instead of
  // leaving the reader with the generic failure toast. The wording is the one
  // the notification centre already uses for the same state. `isSupported` is
  // null until the mount read lands, and an unread answer is not a "no".
  let accountDescription = t("pushDescription");
  if (push.isSupported === false) {
    accountDescription = t("pushUnsupported");
  } else if (push.isBlocked) {
    accountDescription = tCenter("browserPermissionDeniedDescription");
  }

  // Both messages above describe this browser, next to a switch that writes the
  // account. Saying what the switch still does keeps it from reading as dead.
  //
  // Both halves are three-state aware, so a capability the mount read has not
  // answered yet stays silent rather than claiming a block.
  const knownUnableHere = push.isSupported === false || push.isBlocked;

  // The account-off wording waits for `canToggleAccount`, so a preference still
  // in flight does not read as an account that is switched off.
  let deviceDescription = t("pushDeviceDescription");
  if (knownUnableHere) {
    deviceDescription = t("pushDeviceUnavailableDescription");
  } else if (push.canToggleAccount && !push.isAccountEnabled) {
    deviceDescription = t("pushDeviceInactiveDescription");
  }

  // The reader gets one wording for every failure, so log the real reason: a
  // browser that refuses a push subscription looks the same on screen as a Core
  // write that failed.
  const reportFailure = (error: unknown) => {
    console.error("Failed to update push notifications", error);
    return t("pushError");
  };

  /**
   * One shape for both rows. The switches stay enabled while a save runs so
   * focus survives it, which makes this guard the thing that stops a second
   * click landing on top of the first. `success` is a callback so each row
   * keeps its own literal message keys.
   *
   * Whether a row may be toggled at all is the `disabled` prop's job below. A
   * disabled switch fires no change, so a second check here would be dead.
   */
  const toggleHandler =
    <T,>(
      change: (next: boolean) => Promise<T>,
      success: (next: boolean, result: T) => string,
    ) =>
    (nextValue: boolean) => {
      if (push.isSaving) {
        return;
      }

      toast.promise(change(nextValue), {
        loading: t("loading"),
        success: (result: T) => success(nextValue, result),
        error: reportFailure,
      });
    };

  const handleAccountToggle = toggleHandler(
    push.setAccountEnabled,
    (next, subscribedHere) => {
      if (!next) {
        return t("pushDisabledEverywhereSuccess");
      }

      // What the write actually did, rather than what this view can guess.
      // This browser stays out when it cannot push and when the reader refuses
      // the prompt, and a flat "enabled" would contradict the device row.
      return subscribedHere
        ? t("pushEnabledSuccess")
        : t("pushEnabledOtherDevicesSuccess");
    },
  );

  const handleDeviceToggle = toggleHandler(push.setDeviceEnabled, (next) =>
    next ? t("pushDeviceEnabledSuccess") : t("pushDeviceDisabledSuccess"),
  );

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-5 font-medium">{t("pushTitle")}</p>
          <p
            className="text-muted-foreground text-sm leading-6"
            id={accountDescriptionId}
          >
            {knownUnableHere
              ? `${accountDescription} ${t("pushOtherDevicesHint")}`
              : accountDescription}
          </p>
        </div>
        <Switch
          checked={push.isAccountEnabled}
          onCheckedChange={handleAccountToggle}
          disabled={!push.canToggleAccount}
          aria-describedby={accountDescriptionId}
          aria-label={t("pushAriaLabel")}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-5 font-medium">
            {t("pushDeviceTitle")}
          </p>
          <p
            className="text-muted-foreground text-sm leading-6"
            id={deviceDescriptionId}
          >
            {deviceDescription}
          </p>
        </div>
        <Switch
          checked={push.isDeviceEnabled}
          onCheckedChange={handleDeviceToggle}
          disabled={!push.canToggleDevice}
          aria-describedby={deviceDescriptionId}
          aria-label={t("pushDeviceAriaLabel")}
        />
      </div>
    </>
  );
}
