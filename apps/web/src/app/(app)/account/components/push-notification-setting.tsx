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

  // A blocked browser fails every enable, so name the block instead of leaving
  // the reader with the generic failure toast. The wording is the one the
  // notification centre already uses for the same state.
  let accountDescription = t("pushDescription");
  if (!push.isSupported) {
    accountDescription = t("pushUnsupported");
  } else if (push.isBlocked) {
    accountDescription = tCenter("browserPermissionDeniedDescription");
  }

  // The reader gets one wording for every failure, so log the real reason: a
  // browser that refuses a push subscription looks the same on screen as a Core
  // write that failed.
  const reportFailure = (error: unknown) => {
    console.error("Failed to update push notifications", error);
    return t("pushError");
  };

  // The switches stay enabled while a save runs, so focus survives it.
  // `canSubmit` is what stops a second click landing on top of the first.
  const handleAccountToggle = (nextValue: boolean) => {
    if (!push.canSubmit) {
      return;
    }

    toast.promise(push.setAccountEnabled(nextValue), {
      loading: t("loading"),
      success: () =>
        nextValue
          ? t("pushEnabledSuccess")
          : t("pushDisabledEverywhereSuccess"),
      error: reportFailure,
    });
  };

  const handleDeviceToggle = (nextValue: boolean) => {
    if (!push.canSubmit) {
      return;
    }

    toast.promise(push.setDeviceEnabled(nextValue), {
      loading: t("loading"),
      success: () =>
        nextValue ? t("pushDeviceEnabledSuccess") : t("pushDisabledSuccess"),
      error: reportFailure,
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-5 font-medium">{t("pushTitle")}</p>
          <p
            className="text-muted-foreground text-sm leading-6"
            id={accountDescriptionId}
          >
            {accountDescription}
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
            {push.isAccountEnabled
              ? t("pushDeviceDescription")
              : t("pushDeviceInactiveDescription")}
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
