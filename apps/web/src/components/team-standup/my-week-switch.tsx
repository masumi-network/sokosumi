"use client";

import { useTranslations } from "next-intl";
import { ChatPreferenceSwitch } from "@/app/account/components/chat-preference-switch";
import { authClient } from "@/lib/auth/auth.client";

/** The person's own "Include my week in the stand-up" switch, stored as "hide" so false means included. */
export function MyWeekSwitch({ included }: { included: boolean }) {
  const t = useTranslations("App.TeamStandup.MyWeek");
  return (
    <ChatPreferenceSwitch
      title={t("title")}
      description={t("description")}
      initialValue={included}
      save={async (value) => {
        const result = await authClient.updateUser({
          hideWeekFromStandup: !value,
        });
        if (result.error)
          throw new Error(result.error.message ?? "update_failed");
      }}
      messages={{
        loading: t("loading"),
        enabled: t("enabled"),
        disabled: t("disabled"),
        error: t("error"),
      }}
    />
  );
}
