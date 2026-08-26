"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import type { PushDisableScope } from "@/lib/ably/use-push-preference";
import { usePushPreference } from "@/lib/ably/use-push-preference";
import { useSession } from "@/lib/auth/auth.client";

/**
 * The push row of the notification card. It sits apart from the email rows
 * because it changes for different reasons: those write through Better Auth,
 * this one drives Ably and the Core preferences endpoint.
 */
export function PushNotificationSetting() {
  const t = useTranslations("App.Account.Notifications");
  const tCenter = useTranslations("Components.NotificationCenter");
  const { data: session } = useSession();
  const push = usePushPreference(session?.user.id);
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const descriptionId = useId();

  // A blocked browser fails every enable, so name the block instead of leaving
  // the reader with the generic failure toast. The wording is the one the
  // notification centre already uses for the same state.
  let description = t("pushDescription");
  if (!push.isSupported) {
    description = t("pushUnsupported");
  } else if (push.isBlocked) {
    description = tCenter("browserPermissionDeniedDescription");
  }

  // Turning push off is account-wide unless the reader says otherwise, so the
  // switch asks instead of guessing which of their browsers to silence.
  const handleToggle = (nextValue: boolean) => {
    // The switch stays enabled while a save runs, so that closing the disable
    // dialog can hand focus back to it. `canSubmit` is what stops a second
    // click landing on top of the first.
    if (!push.canSubmit) {
      return;
    }

    if (!nextValue) {
      setIsDisableDialogOpen(true);
      return;
    }

    toast.promise(push.enable(), {
      loading: t("loading"),
      success: () => t("pushEnabledSuccess"),
      error: () => t("pushError"),
    });
  };

  const handleDisable = (scope: PushDisableScope) => {
    setIsDisableDialogOpen(false);
    toast.promise(push.disable(scope), {
      loading: t("loading"),
      success: () =>
        scope === "allDevices"
          ? t("pushDisabledEverywhereSuccess")
          : t("pushDisabledSuccess"),
      error: () => t("pushError"),
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-5 font-medium">{t("pushTitle")}</p>
          <p
            className="text-muted-foreground text-sm leading-6"
            id={descriptionId}
          >
            {description}
          </p>
        </div>
        <Switch
          checked={push.enabled}
          onCheckedChange={handleToggle}
          disabled={!push.canToggle}
          aria-describedby={descriptionId}
          aria-label={t("pushAriaLabel")}
        />
      </div>

      <AlertDialog
        open={isDisableDialogOpen}
        onOpenChange={setIsDisableDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pushDisableDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pushDisableDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pushDisableDialogCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDisable("thisDevice");
              }}
            >
              {t("pushDisableDialogThisDevice")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDisable("allDevices");
              }}
            >
              {t("pushDisableDialogAllDevices")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
