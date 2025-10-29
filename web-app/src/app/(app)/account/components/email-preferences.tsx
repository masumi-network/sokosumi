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
  jobStatusEmailNotificationsEnabled: boolean;
  marketingOptIn: boolean;
}

export function EmailPreferences(initialValue: EmailPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  // Use prop directly as initial state; updates come from user interaction
  const [
    jobStatusEmailNotificationsEnabled,
    setJobStatusEmailNotificationsEnabled,
  ] = useState(initialValue.jobStatusEmailNotificationsEnabled);
  const [marketingOptIn, setMarketingOptIn] = useState(
    initialValue.marketingOptIn,
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleJobStatusEmailNotificationsToggle = (nextValue: boolean) => {
    if (isSaving) {
      return;
    }

    const previous = jobStatusEmailNotificationsEnabled;
    setJobStatusEmailNotificationsEnabled(nextValue);
    setIsSaving(true);

    const updatePromise = authClient
      .updateUser({
        jobStatusEmailNotificationsEnabled: nextValue,
      })
      .then((result) => {
        if (result.error) {
          throw new Error(result.error.message ?? "update_failed");
        }
      });

    toast.promise(updatePromise, {
      loading: t("loading"),
      success: () =>
        nextValue
          ? t("jobStatusEmailsEnabledSuccess")
          : t("jobStatusEmailsDisabledSuccess"),
      error: () => {
        setJobStatusEmailNotificationsEnabled(previous);
        return t("error");
      },
    });

    updatePromise
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleMarketingOptInToggle = (nextValue: boolean) => {
    if (isSaving) {
      return;
    }

    const previous = marketingOptIn;
    setMarketingOptIn(nextValue);
    setIsSaving(true);

    const updatePromise = authClient
      .updateUser({
        marketingOptIn: nextValue,
      })
      .then((result) => {
        if (result.error) {
          throw new Error(result.error.message ?? "update_failed");
        }
      });

    toast.promise(updatePromise, {
      loading: t("loading"),
      success: () =>
        nextValue
          ? t("marketingEmailsEnabledSuccess")
          : t("marketingEmailsDisabledSuccess"),
      error: () => {
        setMarketingOptIn(previous);

        return t("error");
      },
    });

    updatePromise
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

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
            checked={jobStatusEmailNotificationsEnabled}
            onCheckedChange={handleJobStatusEmailNotificationsToggle}
            disabled={isSaving}
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
            disabled={isSaving}
            aria-label={t("marketingEmailsAriaLabel")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
