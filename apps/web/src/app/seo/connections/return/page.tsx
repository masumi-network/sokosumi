"use client";

import { useTranslations } from "next-intl";
import { SeoConnectionCallback } from "./seo-connection-callback";
import { useSeoConnectionHandoff } from "./use-seo-connection-callback";

export default function SeoConnectionReturnPage() {
  const t = useTranslations("App.Seo.connections");
  const context = useSeoConnectionHandoff();
  if (context === undefined) return <p role="status">{t("callbackWorking")}</p>;
  return <SeoConnectionCallback context={context} />;
}
