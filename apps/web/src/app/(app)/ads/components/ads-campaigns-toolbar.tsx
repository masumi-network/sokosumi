"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useState } from "react";

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

// The wizard and its fields load on the first open, not with the list.
const AdsNewCampaignDialog = dynamic(
  () =>
    import("./ads-new-campaign-dialog").then(
      (module) => module.AdsNewCampaignDialog,
    ),
  { ssr: false },
);

const queryParsers = { account: adsSearchParams.account };

interface AdsCampaignsToolbarProps {
  accounts: ProjectAdAccount[];
  account: ProjectAdAccount;
  projectId: string;
  range: RangeParam;
}

/**
 * The Campaigns tab's controls, on the tab row as on Schedules: the account
 * and range (kept in `?account=` and `?range=` so the server loads what the
 * URL names) and "New campaign", which opens the create wizard for the
 * selected account. The switcher only appears with two or more accounts.
 */
export function AdsCampaignsToolbar({
  accounts,
  account,
  projectId,
  range,
}: AdsCampaignsToolbarProps) {
  const t = useTranslations("App.Ads.campaigns");
  const [, setQuery] = useQueryStates(queryParsers, { shallow: false });
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {accounts.length > 1 ? (
        <Select
          value={account.id}
          onValueChange={(value) => void setQuery({ account: value })}
        >
          <SelectTrigger
            aria-label={t("account")}
            className="w-full sm:w-48"
            size="sm"
          >
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
      <AdsRangeToggle range={range} />
      <Button
        className="ml-auto sm:ml-0"
        onClick={() => setCreating(true)}
        size="sm"
        type="button"
      >
        <Plus aria-hidden className="size-4" />
        {t("new")}
      </Button>
      {creating ? (
        <AdsNewCampaignDialog
          account={account}
          onClose={() => setCreating(false)}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}
