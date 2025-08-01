"use client";

import { Bookmark, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AgentBookmarkButton,
  AgentDetail,
  AgentModal,
} from "@/components/agents";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentName,
} from "@/lib/db";

export function HeaderSkeleton() {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="flex flex-row items-center gap-4">
        <Skeleton className="h-8 w-60 xl:h-9" />
        <Skeleton className="h-6 w-16" />
        <Button variant="secondary" size="icon" disabled>
          <Bookmark className="animate-pulse" />
        </Button>
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
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
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  executedJobsCount: number;
  averageExecutionDuration: number;
  favoriteAgents: AgentWithRelations[];
  disabled?: boolean;
}

export default function Header({
  agent,
  agentCreditsPrice,
  executedJobsCount,
  averageExecutionDuration,
  favoriteAgents,
  disabled,
}: HeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");
  const [detailOpen, setDetailOpen] = useState(false);
  const isFavorite = favoriteAgents.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  const handleDetailsClick = () => {
    setDetailOpen(true);
  };

  const handleDetailClose = () => {
    setDetailOpen(false);
  };

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="flex flex-row items-center gap-4">
        <h1 className="text-3xl leading-none font-light tracking-tighter text-nowrap">
          {getAgentName(agent)}
        </h1>
        <Button
          className="text-sm leading-tight font-medium"
          variant="ghost"
          disabled={disabled}
          onClick={handleDetailsClick}
        >
          {t("details")}
        </Button>
        <AgentBookmarkButton
          agentId={agent.id}
          isFavorite={isFavorite}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
        <div className="w-full text-end text-sm font-semibold">
          {t("price", {
            price: convertCentsToCredits(agentCreditsPrice.cents),
          })}
        </div>
        <CreateJobModalTrigger agentId={agent.id} disabled={disabled} />
      </div>
      {/* Agent Modal */}
      <AgentModal open={detailOpen}>
        <AgentDetail
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
          favoriteAgents={favoriteAgents}
          showBackButton={false}
          showCloseButton
          onClose={handleDetailClose}
          cardClassName="agent-modal-card p-3 md:p-6"
        />
      </AgentModal>
    </div>
  );
}
