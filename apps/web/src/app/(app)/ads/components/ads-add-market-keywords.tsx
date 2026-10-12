"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listAdMarketKeywords } from "@/lib/actions/ads/action";

interface AdsAddMarketKeywordsProps {
  projectId: string;
  /** Adds the keywords to the form; returns how many were new. */
  onAdd: (keywords: string[]) => number;
}

/**
 * "Add from Market". The keywords are loaded on click, not with the page:
 * when Core's cache has run out that is a paid request to the data provider.
 */
export function AdsAddMarketKeywords({
  projectId,
  onAdd,
}: AdsAddMarketKeywordsProps) {
  const t = useTranslations("App.Ads.newCampaign.keywords");
  const [loading, setLoading] = useState(false);

  async function handleClick(): Promise<void> {
    setLoading(true);
    try {
      const result = await listAdMarketKeywords({ projectId });
      if (!result.ok) {
        toast.error(t("marketFailed"));
      } else if (onAdd(result.value) === 0) {
        toast.info(t("marketNone"));
      }
    } catch {
      toast.error(t("marketFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      loading={loading}
      onClick={() => void handleClick()}
      size="sm"
      type="button"
      variant="ghost"
    >
      {t("addFromMarket")}
    </Button>
  );
}
