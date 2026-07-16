"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface TaskVendorGrantPendingInfoBannerProps {
  coworkerName: string | null;
}

export function TaskVendorGrantPendingInfoBanner({
  coworkerName,
}: TaskVendorGrantPendingInfoBannerProps) {
  const t = useTranslations("App.Tasks.Detail.VendorGrantPendingInfo");

  return (
    <Alert className="mt-4">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <p>
          {coworkerName
            ? t("descriptionWithCoworker", { coworkerName })
            : t("description")}
        </p>
      </AlertDescription>
    </Alert>
  );
}
