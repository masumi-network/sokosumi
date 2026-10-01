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
  accountId: string;
  projectId: string;
  range: RangeParam;
}

/**
 * Account and range, kept in `?account=` and `?range=` so the server loads
 * what the URL names. The switcher only appears with two or more accounts,
 * and "New campaign" only while one of them is selected.
 */
export function AdsCampaignsToolbar({
  accounts,
  accountId,
  projectId,
  range,
}: AdsCampaignsToolbarProps) {
  const t = useTranslations("App.Ads.campaigns");
  const [, setQuery] = useQueryStates(queryParsers, { shallow: false });
  const selected = accounts.find(({ id }) => id === accountId);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {accounts.length > 1 ? (
        <Select
          value={accountId}
          onValueChange={(value) => void setQuery({ account: value })}
        >
          <SelectTrigger aria-label={t("account")} className="w-64 max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
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
        {selected ? (
          <AdsNewCampaign
            accountId={selected.id}
            currency={selected.currency}
            projectId={projectId}
            provider={selected.provider}
          />
        ) : null}
      </div>
    </div>
  );
}
