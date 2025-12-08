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

interface EmailPreferencesProps {
  notificationsOptIn: boolean;
  marketingOptIn: boolean;
}

export function EmailPreferences({
  notificationsOptIn: initialNotificationsOptIn,
  marketingOptIn: initialMarketingOptIn,
}: EmailPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [notificationsOptIn, setNotificationsOptIn] = useState(
    initialNotificationsOptIn,
  );
  const [marketingOptIn, setMarketingOptIn] = useState(initialMarketingOptIn);
  const [isJobStatusSaving, setIsJobStatusSaving] = useState(false);
  const [isMarketingSaving, setIsMarketingSaving] = useState(false);

  const createToggleHandler = (
    field: "notificationsOptIn" | "marketingOptIn",
    currentValue: boolean,
    setValue: (value: boolean) => void,
    setLoading: (loading: boolean) => void,
    enabledSuccessKey: string,
    disabledSuccessKey: string,
  ) => {
    return (nextValue: boolean) => {
      if (isJobStatusSaving || isMarketingSaving) {
        return;
      }

      const previous = currentValue;
      setValue(nextValue);
      setLoading(true);

      const updatePromise = authClient
        .updateUser({
          [field]: nextValue,
        })
        .then((result) => {
          if (result.error) {
            throw new Error(result.error.message ?? "update_failed");
          }
        });

      toast.promise(updatePromise, {
        loading: t("loading"),
        success: () =>
          nextValue ? t(enabledSuccessKey) : t(disabledSuccessKey),
        error: () => {
          setValue(previous);
          return t("error");
        },
      });

      updatePromise
        .catch((error) => {
          console.error(error);
        })
        .finally(() => {
          setLoading(false);
        });
    };
  };

  const handleNotificationsOptInToggle = createToggleHandler(
    "notificationsOptIn",
    notificationsOptIn,
    setNotificationsOptIn,
    setIsJobStatusSaving,
    "jobStatusEmailsEnabledSuccess",
    "jobStatusEmailsDisabledSuccess",
  );

  const handleMarketingOptInToggle = createToggleHandler(
    "marketingOptIn",
    marketingOptIn,
    setMarketingOptIn,
    setIsMarketingSaving,
    "marketingEmailsEnabledSuccess",
    "marketingEmailsDisabledSuccess",
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm leading-5 font-medium">
              {t("jobStatusEmailsTitle")}
            </p>
            <p className="text-muted-foreground text-sm leading-6">
              {t("jobStatusEmailsDescription")}
            </p>
          </div>
          <Switch
            checked={notificationsOptIn}
            onCheckedChange={handleNotificationsOptInToggle}
            disabled={isJobStatusSaving}
            aria-label={t("jobStatusEmailsAriaLabel")}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm leading-5 font-medium">
              {t("marketingEmailsTitle")}
            </p>
            <p className="text-muted-foreground text-sm leading-6">
              {t("marketingEmailsDescription")}
            </p>
          </div>
          <Switch
            checked={marketingOptIn}
            onCheckedChange={handleMarketingOptInToggle}
            disabled={isMarketingSaving}
            aria-label={t("marketingEmailsAriaLabel")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
