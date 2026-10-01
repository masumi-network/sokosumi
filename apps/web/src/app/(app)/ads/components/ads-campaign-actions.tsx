"use client";

import type { AdCampaign } from "@sokosumi/core-client";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type CampaignActionKind = "pause" | "resume" | "budget";

interface AdsCampaignActionsProps {
  campaign: AdCampaign;
  onAction: (kind: CampaignActionKind) => void;
}

/** Pause or resume (only where the status allows it) and the budget. */
export function AdsCampaignActions({
  campaign,
  onAction,
}: AdsCampaignActionsProps) {
  const t = useTranslations("App.Ads.campaigns.actions");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("label", { name: campaign.name })}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {campaign.status === "ACTIVE" ? (
          <DropdownMenuItem onSelect={() => onAction("pause")}>
            {t("pause")}
          </DropdownMenuItem>
        ) : null}
        {campaign.status === "PAUSED" ? (
          <DropdownMenuItem onSelect={() => onAction("resume")}>
            {t("resume")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onAction("budget")}>
          {t("budget")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
