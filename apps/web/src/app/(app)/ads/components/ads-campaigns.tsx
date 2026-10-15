import type { AdCampaign, ProjectAdProvider } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { campaignDetailsHref, type RangeParam } from "@/app/ads/ads-query";
import { EmptyState } from "@/components/common/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { AdsCampaignActions } from "./ads-campaign-actions";
import { adsFormat } from "./ads-format";

const NUMERIC_COLUMNS = [
  "dailyBudget",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
] as const;

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

/** Dropped below `xl` so the table fits a laptop without scrolling sideways. */
const WIDE_ONLY_COLUMNS: ReadonlySet<string> = new Set(["impressions", "cpc"]);
const WIDE_ONLY_CLASS = "hidden xl:table-cell";

interface AdsCampaignsProps {
  accountId: string;
  campaigns: AdCampaign[];
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
  range: RangeParam;
}

/**
 * One account's campaigns, rendered on the server: a table from `md` up,
 * stacked rows below. Only each row's action menu is client code.
 */
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
      <EmptyState
        description={t("noCampaignsBody")}
        title={t("noCampaignsTitle")}
      />
    );
  }

  const { money, count, percent } = adsFormat(formatter, currency);

  const cells: Record<
    (typeof NUMERIC_COLUMNS)[number],
    (campaign: AdCampaign) => string
  > = {
    dailyBudget: ({ dailyBudget }) => money(dailyBudget),
    spend: ({ spend }) => money(spend),
    impressions: ({ impressions }) => count(impressions),
    clicks: ({ clicks }) => count(clicks),
    ctr: ({ ctr }) => percent(ctr),
    cpc: ({ cpc }) => money(cpc),
    conversions: ({ conversions }) => count(conversions),
  };

  /** Quiet text with a dot. Only Active takes the accent. */
  const status = ({ status }: AdCampaign) => (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "ACTIVE" ? "bg-primary" : "bg-muted-foreground",
        )}
      />
      <span
        className={
          status === "ACTIVE" ? "text-foreground" : "text-muted-foreground"
        }
      >
        {t(`status.${status}`)}
      </span>
    </span>
  );

  /** Google campaigns open their details; Meta has none yet. */
  const name = ({ id, name }: AdCampaign) =>
    provider === "google_ads" ? (
      <Link
        className="underline-offset-4 hover:underline"
        href={campaignDetailsHref(projectId, accountId, id, range)}
      >
        {name}
      </Link>
    ) : (
      name
    );

  const actions = (campaign: AdCampaign) => (
    <AdsCampaignActions
      accountId={accountId}
      campaign={campaign}
      currency={currency}
      projectId={projectId}
      provider={provider}
    />
  );

  return (
    <section aria-label={t("tableLabel")} data-testid="ads-campaigns">
      <div className="hidden md:block" data-testid="ads-campaigns-table">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-muted-foreground font-normal">
                {t("columns.name")}
              </TableHead>
              <TableHead className="text-muted-foreground font-normal">
                {t("columns.status")}
              </TableHead>
              {NUMERIC_COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className={cn(
                    "text-muted-foreground text-right font-normal",
                    WIDE_ONLY_COLUMNS.has(column) && WIDE_ONLY_CLASS,
                  )}
                >
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
              <TableHead className="w-12">
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="max-w-64">
                  <p className="truncate font-medium">{name(campaign)}</p>
                  {campaign.objective ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {formatObjective(campaign.objective, tObjectives)}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>{status(campaign)}</TableCell>
                {NUMERIC_COLUMNS.map((column) => (
                  <TableCell
                    key={column}
                    className={cn(
                      "text-right tabular-nums",
                      WIDE_ONLY_COLUMNS.has(column) && WIDE_ONLY_CLASS,
                    )}
                  >
                    {cells[column](campaign)}
                  </TableCell>
                ))}
                <TableCell className="w-12 text-right">
                  {actions(campaign)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        className="flex flex-col gap-4 md:hidden"
        data-testid="ads-campaigns-rows"
      >
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{name(campaign)}</p>
                {status(campaign)}
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                {t("spendAndClicks", {
                  spend: cells.spend(campaign),
                  clicks: cells.clicks(campaign),
                })}
              </p>
            </div>
            {actions(campaign)}
          </li>
        ))}
      </ul>
    </section>
  );
}
