"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/utils";
import { convertCentsToCredits } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { BottomNavigation } from "@/components/ui/bottom-navigation";
import VerticalDivider from "@/components/vertical-divider";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface AgentPriceBottomNavigationProps {
  agent: AgentWithCreditsPrice;
  /** Trailing action rendered after the price (e.g. hire or create-job). */
  action: ReactNode;
}

/**
 * Mobile bottom navigation bar showing an agent's price plus a trailing action.
 * Shared by the agent detail and agent jobs pages.
 */
export function AgentPriceBottomNavigation({
  agent,
  action,
}: AgentPriceBottomNavigationProps) {
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
        {action}
      </div>
    </BottomNavigation>
  );
}
