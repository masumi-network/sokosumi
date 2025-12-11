"use client";

import { AgentWithCreditsPrice, AgentWithRelations } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton } from "@/components/agents";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { BottomNavigation } from "@/components/ui/bottom-navigation";
import VerticalDivider from "@/components/vertical-divider";

interface JobBottomNavigationProps {
  agent: AgentWithCreditsPrice;
  favoriteAgents: AgentWithRelations[];
  disabled?: boolean;
}

export default function JobBottomNavigation({
  agent,
  favoriteAgents,
  disabled,
}: JobBottomNavigationProps) {
  const t = useTranslations("App.Agents.Jobs.Header");

  const isFavorite = favoriteAgents.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  return (
    <BottomNavigation>
      <div className="flex flex-1 flex-row items-center justify-center gap-2">
        <AgentBookmarkButton
          agentId={agent.id}
          isFavorite={isFavorite}
          disabled={disabled}
        />
        <VerticalDivider />
        <div className="w-full text-center text-sm font-semibold">
          {t("price", {
            price: convertCentsToCredits(agent.creditsPrice.cents),
          })}
        </div>
        <VerticalDivider />
        <CreateJobModalTrigger
          agentId={agent.id}
          disabled={disabled}
          showLabel={false}
        />
      </div>
    </BottomNavigation>
  );
}
