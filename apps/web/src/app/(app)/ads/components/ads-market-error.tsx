"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

import type { MarketLoadError } from "./ads-market";

interface AdsMarketErrorProps {
  kind: MarketLoadError;
  section: "profile" | "keywords" | "ads";
}

/** A market section's own error, so the other section stays usable. */
export function AdsMarketError({ kind, section }: AdsMarketErrorProps) {
  const t = useTranslations("App.Ads.market.errors");
  const router = useRouter();

  if (kind === "unavailable") {
    return (
      <EmptyState
        description={t("unavailable.description")}
        title={t("unavailable.title")}
      />
    );
  }

  return (
    <EmptyState
      action={
        <Button type="button" onClick={() => router.refresh()}>
          {t("retry")}
        </Button>
      }
      description={t("description")}
      title={t(`failed.${section}`)}
    />
  );
}
