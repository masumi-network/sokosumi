"use client";

import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";

import {
  adsSearchParams,
  RANGE_PARAMS,
  type RangeParam,
} from "@/app/ads/ads-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const queryParsers = { range: adsSearchParams.range };

/**
 * 7 or 30 days, kept in `?range=` so the server loads what the URL names.
 * Shared by the campaigns list and a campaign's details.
 */
export function AdsRangeToggle({ range }: { range: RangeParam }) {
  const t = useTranslations("App.Ads.campaigns");
  const [, setQuery] = useQueryStates(queryParsers, { shallow: false });

  return (
    <ToggleGroup
      aria-label={t("rangeLabel")}
      onValueChange={(value) => {
        // Clicking the selected range again would clear it; keep it.
        const next = RANGE_PARAMS.find((candidate) => candidate === value);
        if (next) void setQuery({ range: next });
      }}
      type="single"
      value={range}
    >
      {RANGE_PARAMS.map((candidate) => (
        <ToggleGroupItem key={candidate} value={candidate}>
          {t(`range.${candidate}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
