"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";

import { adsSearchParams, type RangeParam } from "@/app/ads/ads-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { AdsRangeToggle } from "./ads-range-toggle";

const queryParsers = { account: adsSearchParams.account };

interface AdsCampaignsToolbarProps {
  accounts: ProjectAdAccount[];
  account: ProjectAdAccount;
  projectId: string;
  range: RangeParam;
}

/**
 * Account and range, kept in `?account=` and `?range=` so the server loads
 * what the URL names. The switcher only appears with two or more accounts.
 * "New campaign" opens the create page for the selected account.
 */
export function AdsCampaignsToolbar({
  accounts,
  account,
  projectId,
  range,
}: AdsCampaignsToolbarProps) {
  const t = useTranslations("App.Ads.campaigns");
  const [, setQuery] = useQueryStates(queryParsers, { shallow: false });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {accounts.length > 1 ? (
        <Select
          value={account.id}
          onValueChange={(value) => void setQuery({ account: value })}
        >
          <SelectTrigger aria-label={t("account")} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <div className="flex w-full items-center justify-between gap-3 sm:ml-auto sm:w-auto">
        <AdsRangeToggle range={range} />
        <Button asChild size="sm">
          <Link
            href={`/ads/campaigns/new?${new URLSearchParams({ projectId, accountId: account.id })}`}
          >
            {t("new")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
