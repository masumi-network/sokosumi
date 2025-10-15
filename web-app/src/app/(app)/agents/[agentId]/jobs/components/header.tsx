"use client";

import { ArrowLeft, Bookmark, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton } from "@/components/agents";
import { AgentActionButtons } from "@/components/agents/agent-action-buttons";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithCreditsPrice,
  AgentWithRelations,
  convertCentsToCredits,
  getAgentName,
} from "@/lib/db";

export function HeaderSkeleton() {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="md:justify-initial flex flex-col items-center gap-4 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="md:justify-initial flex w-full flex-row items-center justify-between gap-4 md:w-auto md:flex-initial">
        <Button
          variant="secondary"
          size="icon"
          disabled
          className="flex md:hidden"
        >
          <ArrowLeft className="animate-pulse" />
        </Button>
        <Skeleton className="hidden h-8 w-60 md:flex xl:h-9" />
        <Skeleton className="h-6 w-16" />
        <Button
          variant="secondary"
          size="icon"
          disabled
          className="hidden md:flex"
        >
          <Bookmark className="animate-pulse" />
        </Button>
      </div>
      <div className="hidden flex-1 flex-row items-center justify-end gap-4 md:flex">
        <div className="w-full text-end text-sm font-semibold">
          <Skeleton className="ml-auto h-5 w-24" />
        </div>
        <Button className="gap-2" disabled>
          <Plus />
          {t("newJob")}
        </Button>
      </div>
    </div>
  );
}

interface HeaderProps {
  agent: AgentWithCreditsPrice;
  favoriteAgents: AgentWithRelations[];
  disabled?: boolean;
}

export default function Header({
  agent,
  favoriteAgents,
  disabled,
}: HeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");
  const isFavorite = favoriteAgents.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  return (
    <div className="flex flex-col items-center gap-4 pt-14 md:pt-0 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="bg-background/95 fixed top-[64px] z-50 flex w-full flex-row items-center justify-between gap-4 p-4 md:hidden">
        <AgentActionButtons
          agent={agent}
          showBackButton={true}
          showShareButton={false}
          showCloseButton={false}
        />
      </div>
      <div className="flex w-full flex-row items-center justify-between gap-4 md:w-auto md:justify-center">
        <h1 className="text-2xl leading-none font-light tracking-tighter text-nowrap md:text-3xl">
          {getAgentName(agent)}
        </h1>
        <div className="hidden gap-2 md:flex">
          <AgentBookmarkButton
            agentId={agent.id}
            isFavorite={isFavorite}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="hidden flex-1 flex-row items-center justify-end gap-4 md:flex">
        <div className="w-full text-end text-sm font-semibold">
          {t("price", {
            price: convertCentsToCredits(agent.creditsPrice.cents),
          })}
        </div>
        <CreateJobModalTrigger agentId={agent.id} disabled={disabled} />
      </div>
    </div>
  );
}
