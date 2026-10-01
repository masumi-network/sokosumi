"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { adsSearchParams, RANGE_PARAMS, type RangeParam } from "../ads-query";
import { AdsNewCampaign } from "./ads-new-campaign";

const queryParsers = {
  account: adsSearchParams.account,
  range: adsSearchParams.range,
};

interface AdsCampaignsToolbarProps {
  accounts: ProjectAdAccount[];
  account: ProjectAdAccount;
  projectId: string;
  range: RangeParam;
}

/**
 * Account and range, kept in `?account=` and `?range=` so the server loads
 * what the URL names. The switcher only appears with two or more accounts.
 * "New campaign" creates in the selected account.
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
        <ToggleGroup
          aria-label={t("rangeLabel")}
          onValueChange={(value) => {
            // Clicking the selected range again would clear it; keep it.
            const next = RANGE_PARAMS.find((candidate) => candidate === value);
            if (next) void setQuery({ range: next });
          }}
          size="sm"
          type="single"
          value={range}
          variant="outline"
        >
          {RANGE_PARAMS.map((candidate) => (
            <ToggleGroupItem key={candidate} value={candidate}>
              {t(`range.${candidate}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <AdsNewCampaign
          accountId={account.id}
          currency={account.currency}
          projectId={projectId}
          provider={account.provider}
        />
      </div>
    </div>
  );
}
