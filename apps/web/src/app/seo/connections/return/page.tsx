"use client";

import { useTranslations } from "next-intl";
import { useSeoConnectionHandoff } from "@/hooks/effects/use-seo-connection-handoff";
import { SeoConnectionCallback } from "./seo-connection-callback";

export default function SeoConnectionReturnPage() {
  const t = useTranslations("App.Seo.connections");
  const context = useSeoConnectionHandoff();
  if (context === undefined) return <p role="status">{t("callbackWorking")}</p>;
  return <SeoConnectionCallback context={context} />;
}
