"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
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

export function JobStatusEmailPreferences() {
  const t = useTranslations("App.Account.Notifications");
  const { data: session, isPending } = authClient.useSession();

  const currentEnabled = useMemo(
    () => session?.user.jobStatusEmailNotificationsEnabled ?? true,
    [session?.user.jobStatusEmailNotificationsEnabled],
  );
  const [pending, startTransition] = useTransition();
  const [localEnabled, setLocalEnabled] = useState(currentEnabled);

  useEffect(() => {
    setLocalEnabled(currentEnabled);
  }, [currentEnabled]);

  const handleToggle = (nextValue: boolean) => {
    setLocalEnabled(nextValue);
    startTransition(async () => {
      const result = await authClient.updateUser({
        jobStatusEmailNotificationsEnabled: nextValue,
      });
      if (result.error) {
        setLocalEnabled((prev) => !prev);
        toast.error(t("error"));
        return;
      }

      toast.success(nextValue ? t("enabledSuccess") : t("disabledSuccess"));
    });
  };

  const isLoading = isPending || pending;

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
          checked={localEnabled}
          onCheckedChange={handleToggle}
          disabled={isLoading}
          aria-label={t("jobStatusEmailsAriaLabel")}
        />
      </CardContent>
    </Card>
  );
}
