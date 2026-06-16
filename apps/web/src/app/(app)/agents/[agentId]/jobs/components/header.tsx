"use client";

import type { AgentRatingStats, AgentWithCreditsPrice } from "@sokosumi/utils";
import { convertCentsToCredits } from "@sokosumi/utils";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AgentActionButtons } from "@/components/agents/agent-action-buttons";
import { AgentRatingCTA } from "@/components/agents/agent-rating-cta";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

export function HeaderSkeleton() {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col gap-4 pt-14 md:pt-0 lg:gap-6 xl:gap-8">
      <div className="bg-background/95 fixed top-[64px] left-0 z-50 flex w-full items-center justify-between p-4 md:hidden md:gap-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" disabled>
            <ArrowLeft className="animate-pulse" />
          </Button>
        </div>
        <div className="flex items-center gap-2" />
      </div>
      <div className="hidden w-full items-center justify-between md:flex">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" disabled>
            <ArrowLeft className="animate-pulse" />
          </Button>
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-5 w-20" />
          <Button className="h-7 gap-2 px-2.5 text-xs" disabled>
            <Plus />
            {t("newJob")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface HeaderProps {
  agent: AgentWithCreditsPrice;
  ratingStats: AgentRatingStats;
  canRate: boolean;
  existingRating: {
    rating: number;
    comment: string | null;
  } | null;
  disabled?: boolean;
  detailActions?: ReactNode;
}

export default function Header({
  agent,
  ratingStats,
  canRate,
  existingRating,
  disabled,
  detailActions,
}: HeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col gap-4 pt-14 md:pt-0 lg:gap-6 xl:gap-8">
      <div className="bg-background/95 fixed top-[64px] left-0 z-50 flex w-full flex-row items-center justify-between gap-4 p-4 md:hidden">
        <AgentActionButtons
          agent={agent}
          showBackButton={true}
          showShareButton={false}
          showCloseButton={false}
          trailingActions={detailActions}
        />
      </div>
      <div className="hidden w-full md:block">
        <div className="flex w-full items-center justify-between py-4">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>{t("back")}</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">
              {t("price", {
                price: formatCreditsForDisplay(
                  convertCentsToCredits(agent.creditsPrice.cents),
                ),
              })}
            </div>
            {canRate && (
              <AgentRatingCTA
                agentId={agent.id}
                ratingStats={ratingStats}
                existingRating={existingRating}
                disabled={disabled}
                className="size-7"
              />
            )}
            {detailActions}
            <CreateJobModalTrigger
              agentId={agent.id}
              disabled={disabled}
              className="h-7 gap-1.5 px-2.5 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
