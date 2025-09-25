"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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

interface JobStatusEmailPreferencesProps {
  initialEnabled: boolean;
}

export function JobStatusEmailPreferences({
  initialEnabled,
}: JobStatusEmailPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const handleToggle = (nextValue: boolean) => {
    if (isSaving) {
      return;
    }

    const previous = enabled;
    setEnabled(nextValue);
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
      success: () => (nextValue ? t("enabledSuccess") : t("disabledSuccess")),
      error: () => {
        setEnabled(previous);
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
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm leading-5 font-medium">
            {t("jobStatusEmailsTitle")}
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            {t("jobStatusEmailsDescription")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isSaving}
          aria-label={t("jobStatusEmailsAriaLabel")}
        />
      </CardContent>
    </Card>
  );
}
