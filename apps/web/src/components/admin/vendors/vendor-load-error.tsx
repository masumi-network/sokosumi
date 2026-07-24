"use client";

import { useTranslations } from "next-intl";

export function VendorLoadError() {
  const t = useTranslations("App.Admin.Vendors");

  return <p className="text-destructive text-sm">{t("loadFailed")}</p>;
}
