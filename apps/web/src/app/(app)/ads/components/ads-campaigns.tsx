import type { AdCampaign, ProjectAdProvider } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

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

/** What a metric shows when the provider has no value for it. */
const NO_VALUE = "—";

const NUMERIC_COLUMNS = [
  "dailyBudget",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
] as const;

interface AdsCampaignsProps {
  accountId: string;
  campaigns: AdCampaign[];
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
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
}: AdsCampaignsProps) {
  const t = await getTranslations("App.Ads.campaigns");
  const formatter = await getFormatter();

  if (campaigns.length === 0) {
    return (
      <EmptyState
        description={t("noCampaignsBody")}
        title={t("noCampaignsTitle")}
      />
    );
  }

  const money = (value: number | null) =>
    value === null
      ? NO_VALUE
      : formatter.number(value, { style: "currency", currency });
  const count = (value: number | null) =>
    // Conversions can be fractional (Google attributes shares of one).
    value === null
      ? NO_VALUE
      : formatter.number(value, { maximumFractionDigits: 1 });
  // CTR is clicks / impressions as a fraction.
  const percent = (value: number | null) =>
    value === null
      ? NO_VALUE
      : formatter.number(value, { style: "percent", maximumFractionDigits: 2 });

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
                  className="text-muted-foreground text-right font-normal"
                >
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="max-w-64">
                  <p className="truncate font-medium">{campaign.name}</p>
                  {campaign.objective ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {campaign.objective}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>{status(campaign)}</TableCell>
                {NUMERIC_COLUMNS.map((column) => (
                  <TableCell key={column} className="text-right tabular-nums">
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
                <p className="truncate text-sm font-medium">{campaign.name}</p>
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
