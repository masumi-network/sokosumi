"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setJobStatusEmailNotificationsEnabled } from "@/lib/actions";

interface JobStatusEmailPreferencesProps {
  initialEnabled: boolean;
}

export function JobStatusEmailPreferences({
  initialEnabled,
}: JobStatusEmailPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const handleToggle = (nextValue: boolean) => {
    const previous = enabled;
    setEnabled(nextValue);
    startTransition(async () => {
      const actionPromise = setJobStatusEmailNotificationsEnabled(nextValue);
      const wrappedPromise = actionPromise.then((result) => {
        if (!result.success) {
          throw new Error("failed to update job status email notifications");
        }
        return result;
      });
      toast.promise(wrappedPromise, {
        loading: t("loading"),
        success: () => {
          return nextValue ? t("enabledSuccess") : t("disabledSuccess");
        },
        error: () => {
          setEnabled(previous);
          return t("error");
        },
      });
      try {
        await wrappedPromise;
      } catch (error) {
        console.error(error);
      }
    });
  };

  const isLoading = pending;

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
          disabled={isLoading}
          aria-label={t("jobStatusEmailsAriaLabel")}
        />
      </CardContent>
    </Card>
  );
}
