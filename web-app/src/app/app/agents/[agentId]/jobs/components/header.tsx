"use client";

import { Bookmark, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AgentBookmarkButton,
  AgentDetail,
  AgentModal,
} from "@/components/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentName,
  JobWithRelations,
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
  favoriteAgentList: AgentListWithAgent;
  jobs: JobWithRelations[];
}

export default function Header({
  agent,
  agentCreditsPrice,
  favoriteAgentList,
  jobs,
}: HeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");
  const [open, setOpen] = useState(false);

  const handleDetailsClick = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
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
          onClick={handleDetailsClick}
        >
          {t("details")}
        </Button>
        <AgentBookmarkButton agentId={agent.id} agentList={favoriteAgentList} />
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
        <div className="w-full text-end text-sm font-semibold">
          {t("price", {
            price: convertCentsToCredits(agentCreditsPrice.cents),
          })}
        </div>
        <Button variant="primary" className="gap-2" asChild>
          <Link href={`/app/agents/${agent.id}/jobs`}>
            <Plus />
            {t("newJob")}
          </Link>
        </Button>
      </div>
      {/* Agent Modal */}
      <AgentModal open={open}>
        <AgentDetail
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          agentList={favoriteAgentList}
          jobs={jobs}
          showBackButton={false}
          showCloseButton
          onClose={handleClose}
        />
      </AgentModal>
    </div>
  );
}
