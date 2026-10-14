import type { AdCampaignPerformance as Performance } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

import type { RangeParam } from "@/app/ads/ads-query";

import { AdsFact, AdsFacts } from "./ads-fact";
import { adsFormat } from "./ads-format";
import { AdsPerformanceChart } from "./ads-performance-chart";
import { AdsRangeToggle } from "./ads-range-toggle";
import { AdsSection } from "./ads-section";

const TOTALS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
] as const;

interface AdsCampaignPerformanceProps {
  currency: string;
  performance: Performance;
  range: RangeParam;
}

/**
 * A campaign's totals over the range, with the range switch, and a bar chart
 * of a day-by-day figure. The totals are server-rendered; only the chart and
 * its switch are client code. A range without any activity says so instead of
 * drawing an empty chart.
 */
export function AdsCampaignPerformance({
  currency,
  performance,
  range,
}: AdsCampaignPerformanceProps) {
  const t = useTranslations("App.Ads.campaignDetails");
  const tColumns = useTranslations("App.Ads.campaigns.columns");
  const { money, count, percent } = adsFormat(useFormatter(), currency);

  const { totals, daily } = performance;
  const cells: Record<(typeof TOTALS)[number], string> = {
    spend: money(totals.spend),
    impressions: count(totals.impressions),
    clicks: count(totals.clicks),
    ctr: percent(totals.ctr),
    cpc: money(totals.cpc),
    conversions: count(totals.conversions),
  };
  const hasActivity = daily.some(
    ({ spend, clicks, impressions, conversions }) =>
      spend > 0 || clicks > 0 || impressions > 0 || conversions > 0,
  );

  return (
    <AdsSection
      action={<AdsRangeToggle range={range} />}
      id="campaign-performance"
      title={t("sections.performance")}
    >
      <AdsFacts
        className="grid-cols-2 sm:grid-cols-3"
        data-testid="performance-totals"
      >
        {TOTALS.map((key) => (
          <AdsFact key={key} label={tColumns(key)} large>
            {cells[key]}
          </AdsFact>
        ))}
      </AdsFacts>

      {hasActivity ? (
        <AdsPerformanceChart currency={currency} daily={daily} />
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("performance.empty")}
        </p>
      )}
    </AdsSection>
  );
}
