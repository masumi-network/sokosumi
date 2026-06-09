"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { AgentHireButton } from "@/components/agents";
import { BottomNavigation } from "@/components/ui/bottom-navigation";
import VerticalDivider from "@/components/vertical-divider";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface AgentBottomNavigationProps {
  agent: AgentWithCreditsPrice;
}

export default function AgentBottomNavigation({
  agent,
}: AgentBottomNavigationProps) {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <BottomNavigation>
      <div className="flex flex-1 flex-row items-center justify-center gap-2">
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
