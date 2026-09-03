"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { NOTIFICATION_PREFERENCES_ANCHOR } from "../constants";
import { NotificationKinds } from "./notification-kinds";
import { PushNotificationSetting } from "./push-notification-setting";

interface NotificationPreferencesProps {
  notificationsOptIn: boolean;
  marketingOptIn: boolean;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

export function NotificationPreferences({
  notificationsOptIn: initialNotificationsOptIn,
  marketingOptIn: initialMarketingOptIn,
}: NotificationPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [notificationsOptIn, setNotificationsOptIn] = useState(
    initialNotificationsOptIn,
  );
  const [marketingOptIn, setMarketingOptIn] = useState(initialMarketingOptIn);
  // One flag for both fields: a write of either refuses the other, so there is
  // no state where they differ and no control that reports only its own.
  const [isSaving, setIsSaving] = useState(false);

  const createToggleHandler = (
    field: "notificationsOptIn" | "marketingOptIn",
    currentValue: boolean,
    setValue: (value: boolean) => void,
    enabledSuccessKey: string,
    disabledSuccessKey: string,
  ) => {
    return (nextValue: boolean) => {
      if (isSaving) {
        return;
      }

      const previous = currentValue;
      setValue(nextValue);
      setIsSaving(true);

      // The value goes back on the chain rather than inside the toast, so it
      // is put back whether or not the toast renders its error, and never
      // after the flag that tells a row the write has settled. React coalesces
      // the two updates today, so a row reads one settled pair either way;
      // this does not lean on that. `useNotificationDelivery` orders the
      // channel writes the same way.
      // Called inside the chain, so a throw on the way out is a rejection the
      // catch and the finally still see. Thrown before it, the flag would stay
      // set for the life of the page and every control would refuse forever.
      const updatePromise = Promise.resolve()
        .then(() => authClient.updateUser({ [field]: nextValue }))
        .then((result: UpdateUserResult) => {
          if (result.error) {
            throw new Error(result.error.message ?? "update_failed");
          }
        })
        .catch((error: unknown) => {
          setValue(previous);
          throw error;
        })
        .finally(() => {
          setIsSaving(false);
        });

      toast.promise(updatePromise, {
        loading: t("loading"),
        success: () =>
          nextValue ? t(enabledSuccessKey) : t(disabledSuccessKey),
        error: () => t("error"),
      });
    };
  };

  const handleNotificationsOptInToggle = createToggleHandler(
    "notificationsOptIn",
    notificationsOptIn,
    setNotificationsOptIn,
    "jobStatusEmailsEnabledSuccess",
    "jobStatusEmailsDisabledSuccess",
  );

  const handleMarketingOptInToggle = createToggleHandler(
    "marketingOptIn",
    marketingOptIn,
    setMarketingOptIn,
    "marketingEmailsEnabledSuccess",
    "marketingEmailsDisabledSuccess",
  );

  return (
    <Card className="flex h-full flex-col" id={NOTIFICATION_PREFERENCES_ANCHOR}>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The matrix first: it is the decision the reader came for, and the
            rows under it are what each of its columns needs to arrive.
            Marketing sits apart at the end because it is not a notification
            about their work, and no row of the matrix reaches it. */}
        {/* Busy while either write is in flight, because the handler refuses
            both then. A cell that took the press and did nothing would look
            broken; dimmed and marked busy, it says why. */}
        <NotificationKinds
          email={{
            enabled: notificationsOptIn,
            saving: isSaving,
            onChange: handleNotificationsOptInToggle,
          }}
        />
        <PushNotificationSetting />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm leading-5 font-medium">
              {t("marketingEmailsTitle")}
            </p>
            <p className="text-muted-foreground text-sm leading-6">
              {t("marketingEmailsDescription")}
            </p>
          </div>
          {/* Busy while either write is in flight, for the same reason the
              email cell is: the handler refuses both, and a switch that took
              the press and snapped back would say nothing about why. Marked
              rather than disabled, so it keeps its place in the tab order and
              a reader who is on it is not dropped somewhere else. */}
          <Switch
            checked={marketingOptIn}
            onCheckedChange={handleMarketingOptInToggle}
            aria-disabled={isSaving || undefined}
            className={cn(isSaving && "opacity-50")}
            aria-label={t("marketingEmailsAriaLabel")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
