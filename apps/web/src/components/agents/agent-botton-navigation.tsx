"use client";

import type {
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton, AgentHireButton } from "@/components/agents";
import { BottomNavigation } from "@/components/ui/bottom-navigation";
import VerticalDivider from "@/components/vertical-divider";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface AgentBottomNavigationProps {
  agent: AgentWithCreditsPrice;
  favoriteAgents: AgentWithRelations[];
  disabled?: boolean;
}

export default function AgentBottomNavigation({
  agent,
  favoriteAgents,
  disabled,
}: AgentBottomNavigationProps) {
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
            price: formatCreditsForDisplay(
              convertCentsToCredits(agent.creditsPrice.cents),
            ),
          })}
        </div>
        <VerticalDivider />
        <AgentHireButton agentId={agent.id} />
      </div>
    </BottomNavigation>
  );
}
