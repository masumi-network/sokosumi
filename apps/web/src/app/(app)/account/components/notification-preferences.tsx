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
import { authClient } from "@/lib/auth/auth.client";
import { NOTIFICATION_PREFERENCES_ANCHOR } from "../constants";
import { NotificationKinds } from "./notification-kinds";

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
      <CardContent>
        {/* Everything the card can answer is in the one grid: what Sokosumi
            tells you about, and where each of those things reaches you. Both
            account switches are rows of it, so a reader answers one question
            in one place rather than meeting a second kind of control below.
            Push has no row of its own at all: a cell asks the browser. */}
        {/* Busy while either write is in flight, because the handler refuses
            both then. A cell that took the press and did nothing would look
            broken; dimmed and marked busy, it says why. */}
        <NotificationKinds
          email={{
            enabled: notificationsOptIn,
            saving: isSaving,
            onChange: handleNotificationsOptInToggle,
          }}
          news={{
            enabled: marketingOptIn,
            saving: isSaving,
            onChange: handleMarketingOptInToggle,
          }}
        />
      </CardContent>
    </Card>
  );
}
