"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { BottomNavigation } from "@/components/ui/bottom-navigation";
import VerticalDivider from "@/components/vertical-divider";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface JobBottomNavigationProps {
  agent: AgentWithCreditsPrice;
  disabled?: boolean;
}

export default function JobBottomNavigation({
  agent,
  disabled,
}: JobBottomNavigationProps) {
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
        <CreateJobModalTrigger
          agentId={agent.id}
          disabled={disabled}
          showLabel={false}
        />
      </div>
    </BottomNavigation>
  );
}
