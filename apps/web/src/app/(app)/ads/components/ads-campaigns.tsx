"use client";

import type { AdCampaign } from "@sokosumi/core-client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatCount, formatMoney, formatPercent } from "../format-ads";
import {
  AdsCampaignActions,
  type CampaignActionKind,
} from "./ads-campaign-actions";
import {
  AdsCampaignBudgetDialog,
  AdsCampaignStatusDialog,
} from "./ads-campaign-dialogs";
import { AdsCampaignStatus } from "./ads-campaign-status";

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
}

/**
 * One account's campaigns: a table from `md` up, stacked rows below. Pause,
 * resume and the budget go through a confirm step and then a server action;
 * the page revalidates, so the list is never patched locally.
 */
export function AdsCampaigns({
  accountId,
  campaigns,
  currency,
  projectId,
}: AdsCampaignsProps) {
  const t = useTranslations("App.Ads.campaigns");
  const locale = useLocale();
  const [pending, setPending] = useState<{
    campaign: AdCampaign;
    kind: CampaignActionKind;
  } | null>(null);

  if (campaigns.length === 0) {
    return (
      <EmptyState
        description={t("noCampaignsBody")}
        title={t("noCampaignsTitle")}
      />
    );
  }

  const money = (value: number | null) => formatMoney(value, currency, locale);
  const cells: Record<
    (typeof NUMERIC_COLUMNS)[number],
    (campaign: AdCampaign) => string
  > = {
    dailyBudget: ({ dailyBudget }) => money(dailyBudget),
    spend: ({ spend }) => money(spend),
    impressions: ({ impressions }) => formatCount(impressions, locale),
    clicks: ({ clicks }) => formatCount(clicks, locale),
    ctr: ({ ctr }) => formatPercent(ctr, locale),
    cpc: ({ cpc }) => money(cpc),
    conversions: ({ conversions }) => formatCount(conversions, locale),
  };

  const dialogProps = pending && {
    accountId,
    campaign: pending.campaign,
    onClose: () => setPending(null),
    projectId,
  };

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
                <TableCell>
                  <AdsCampaignStatus status={campaign.status} />
                </TableCell>
                {NUMERIC_COLUMNS.map((column) => (
                  <TableCell key={column} className="text-right tabular-nums">
                    {cells[column](campaign)}
                  </TableCell>
                ))}
                <TableCell className="w-12 text-right">
                  <AdsCampaignActions
                    campaign={campaign}
                    onAction={(kind) => setPending({ campaign, kind })}
                  />
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
                <AdsCampaignStatus status={campaign.status} />
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                {t("spendAndClicks", {
                  spend: cells.spend(campaign),
                  clicks: cells.clicks(campaign),
                })}
              </p>
            </div>
            <AdsCampaignActions
              campaign={campaign}
              onAction={(kind) => setPending({ campaign, kind })}
            />
          </li>
        ))}
      </ul>

      {dialogProps && pending?.kind === "budget" ? (
        <AdsCampaignBudgetDialog {...dialogProps} currency={currency} />
      ) : null}
      {dialogProps && pending && pending.kind !== "budget" ? (
        <AdsCampaignStatusDialog
          {...dialogProps}
          nextStatus={pending.kind === "pause" ? "PAUSED" : "ACTIVE"}
        />
      ) : null}
    </section>
  );
}
