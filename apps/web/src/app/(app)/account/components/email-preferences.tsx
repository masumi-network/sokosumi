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
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import {
  disablePushNotifications,
  enablePushNotifications,
  isPushEnabledLocally,
} from "@/lib/services/push-subscription.service";
import { isWebPushSupported } from "@/lib/utils/web-push";

interface EmailPreferencesProps {
  notificationsOptIn: boolean;
  marketingOptIn: boolean;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

export function EmailPreferences({
  notificationsOptIn: initialNotificationsOptIn,
  marketingOptIn: initialMarketingOptIn,
}: EmailPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [notificationsOptIn, setNotificationsOptIn] = useState(
    initialNotificationsOptIn,
  );
  const [marketingOptIn, setMarketingOptIn] = useState(initialMarketingOptIn);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [isJobStatusSaving, setIsJobStatusSaving] = useState(false);
  const [isMarketingSaving, setIsMarketingSaving] = useState(false);
  const [isPushSaving, setIsPushSaving] = useState(false);

  useMountEffect(() => {
    const supported = isWebPushSupported();
    setPushSupported(supported);
    if (!supported) {
      setPushReady(true);
      return;
    }

    void isPushEnabledLocally()
      .then((enabled) => {
        setPushEnabled(enabled);
      })
      .finally(() => {
        setPushReady(true);
      });
  });

  const createToggleHandler = (
    field: "notificationsOptIn" | "marketingOptIn",
    currentValue: boolean,
    setValue: (value: boolean) => void,
    setLoading: (loading: boolean) => void,
    enabledSuccessKey: string,
    disabledSuccessKey: string,
  ) => {
    return (nextValue: boolean) => {
      if (isJobStatusSaving || isMarketingSaving || isPushSaving) {
        return;
      }

      const previous = currentValue;
      setValue(nextValue);
      setLoading(true);

      const updatePromise = authClient
        .updateUser({
          [field]: nextValue,
        })
        .then((result: UpdateUserResult) => {
          if (result.error) {
            throw new Error(result.error.message ?? "update_failed");
          }
        })
        .finally(() => {
          setLoading(false);
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

  const handlePushToggle = (nextValue: boolean) => {
    if (
      isJobStatusSaving ||
      isMarketingSaving ||
      isPushSaving ||
      !pushSupported
    ) {
      return;
    }

    const previous = pushEnabled;
    setPushEnabled(nextValue);
    setIsPushSaving(true);

    const updatePromise = (
      nextValue ? enablePushNotifications() : disablePushNotifications()
    )
      .then((result) => {
        if (!result.ok) {
          if (result.reason === "permission_denied") {
            throw new Error("permission_denied");
          }
          if (result.reason === "unsupported") {
            throw new Error("unsupported");
          }
          throw new Error("update_failed");
        }
      })
      .finally(() => {
        setIsPushSaving(false);
      });

    toast.promise(updatePromise, {
      loading: t("loading"),
      success: () =>
        nextValue ? t("pushEnabledSuccess") : t("pushDisabledSuccess"),
      error: (error: unknown) => {
        setPushEnabled(previous);
        if (error instanceof Error) {
          if (error.message === "permission_denied") {
            return t("pushPermissionDenied");
          }
          if (error.message === "unsupported") {
            return t("pushUnsupported");
          }
        }
        return t("error");
      },
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
        {pushReady && pushSupported ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm leading-5 font-medium">{t("pushTitle")}</p>
              <p className="text-muted-foreground text-sm leading-6">
                {t("pushDescription")}
              </p>
            </div>
            <Switch
              checked={pushEnabled}
              onCheckedChange={handlePushToggle}
              disabled={isPushSaving}
              aria-label={t("pushAriaLabel")}
            />
          </div>
        ) : null}
        {pushReady && !pushSupported ? (
          <div>
            <p className="text-sm leading-5 font-medium">{t("pushTitle")}</p>
            <p className="text-muted-foreground text-sm leading-6">
              {t("pushUnsupported")}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
