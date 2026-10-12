"use client";

import { useTranslations } from "next-intl";
import { use } from "react";

import { Button } from "@/components/ui/button";

interface AdsAddMarketKeywordsProps {
  /** The project's trending Market keywords, loaded on the server. */
  keywords: Promise<string[]>;
  onAdd: (keywords: string[]) => void;
}

/** "Add from Market": there only when the project has Market keywords. */
export function AdsAddMarketKeywords({
  keywords,
  onAdd,
}: AdsAddMarketKeywordsProps) {
  const t = useTranslations("App.Ads.newCampaign.keywords");
  const names = use(keywords);
  if (names.length === 0) return null;

  return (
    <Button
      onClick={() => onAdd(names)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {t("addFromMarket")}
    </Button>
  );
}
