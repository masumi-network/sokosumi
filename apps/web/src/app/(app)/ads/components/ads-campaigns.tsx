import type { AdCampaign, ProjectAdProvider } from "@sokosumi/core-client";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { campaignDetailsHref, type RangeParam } from "@/app/ads/ads-query";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { AdsCampaignActions } from "./ads-campaign-actions";
import { adsFormat } from "./ads-format";

const METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
] as const;

const WIDE_ONLY_METRICS: ReadonlySet<string> = new Set([
  "impressions",
  "cpc",
  "conversions",
]);

/** Meta objectives with copy under `App.Ads.newCampaign.objectives`. */
const KNOWN_OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
] as const;

type KnownObjective = (typeof KNOWN_OBJECTIVES)[number];

function isKnownObjective(value: string): value is KnownObjective {
  return (KNOWN_OBJECTIVES as readonly string[]).includes(value);
}

/** Prefer the translated Meta objective; otherwise turn "OUTCOME_TRAFFIC" into "Traffic". */
export function formatObjective(
  objective: string,
  labels: (key: KnownObjective) => string,
): string {
  if (isKnownObjective(objective)) {
    return labels(objective);
  }
  const words = objective
    .replace(/^OUTCOME_/, "")
    .replaceAll("_", " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface AdsCampaignsProps {
  accountId: string;
  campaigns: AdCampaign[];
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
  range: RangeParam;
}

export async function AdsCampaigns({
  accountId,
  campaigns,
  currency,
  projectId,
  provider,
  range,
}: AdsCampaignsProps) {
  const t = await getTranslations("App.Ads.campaigns");
  const tObjectives = await getTranslations("App.Ads.newCampaign.objectives");
  const formatter = await getFormatter();

  if (campaigns.length === 0) {
    return (
      <div className={HOLDER_CLASS}>
        <EmptyState
          description={t("noCampaignsBody")}
          icon={Megaphone}
          title={t("noCampaignsTitle")}
        />
      </div>
    );
  }

  const { money, count, percent } = adsFormat(formatter, currency);

  const figures: Record<
    (typeof METRICS)[number],
    (campaign: AdCampaign) => string
  > = {
    spend: ({ spend }) => money(spend),
    impressions: ({ impressions }) => count(impressions),
    clicks: ({ clicks }) => count(clicks),
    ctr: ({ ctr }) => percent(ctr),
    cpc: ({ cpc }) => money(cpc),
    conversions: ({ conversions }) => count(conversions),
  };

  const summary = ({ objective, dailyBudget }: AdCampaign) =>
    [
      objective ? formatObjective(objective, tObjectives) : null,
      dailyBudget === null
        ? null
        : t("budgetPerDay", { budget: money(dailyBudget) }),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section
      aria-label={t("tableLabel")}
      className={HOLDER_CLASS}
      data-testid="ads-campaigns"
    >
      <ul className="flex flex-col gap-2">
        {campaigns.map((campaign) => {
          const linked = provider === "google_ads";
          const objectiveAndBudget = summary(campaign);
          return (
            <li
              key={campaign.id}
              className={cn(
                HOLDER_ITEM_CLASS,
                linked && HOLDER_ITEM_HOVER_CLASS,
                "content-in relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 p-3 transition-colors lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:gap-x-6",
                linked && "press",
              )}
              data-testid="ads-campaign-row"
            >
              <div className="col-start-1 row-start-1 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {linked ? (
                    <Link
                      className="text-foreground focus-visible:after:ring-ring truncate text-sm font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2"
                      href={campaignDetailsHref(
                        projectId,
                        accountId,
                        campaign.id,
                        range,
                      )}
                    >
                      {campaign.name}
                    </Link>
                  ) : (
                    <p className="text-foreground truncate text-sm font-medium">
                      {campaign.name}
                    </p>
                  )}
                  <Badge
                    className="rounded-sm"
                    variant={
                      campaign.status === "ACTIVE" ? "secondary" : "outline"
                    }
                  >
                    {t(`status.${campaign.status}`)}
                  </Badge>
                </div>
                {objectiveAndBudget ? (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                    {objectiveAndBudget}
                  </p>
                ) : null}
              </div>
              <dl className="col-span-2 row-start-2 grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:flex lg:gap-6">
                {METRICS.map((metric) => (
                  <div
                    key={metric}
                    className={cn(
                      "flex min-w-0 flex-col gap-0.5 lg:w-20 lg:items-end",
                      WIDE_ONLY_METRICS.has(metric) && "hidden sm:flex",
                    )}
                  >
                    <dt className="text-muted-foreground text-xs">
                      {t(`columns.${metric}`)}
                    </dt>
                    <dd className="truncate text-sm tabular-nums">
                      {figures[metric](campaign)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="relative z-10 col-start-2 row-start-1 lg:col-start-3">
                <AdsCampaignActions
                  accountId={accountId}
                  campaign={campaign}
                  currency={currency}
                  projectId={projectId}
                  provider={provider}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
