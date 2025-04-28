import { CircleCheck, Clock, RefreshCcw, SquareTerminal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { AgentWithRelations, getAgentAuthorName } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection2({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card2");
  const dateFormatter = useFormatter();

  return (
    <CardSection>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {/* Developer */}
        <div className="flex flex-col gap-0.5 border-r pr-6">
          <div className="flex items-center gap-1.5">
            <SquareTerminal size={16} />
            <span className="text-upper text-xs">{t("developer")}</span>
          </div>
          <p className="text-base font-medium">{getAgentAuthorName(agent)}</p>
        </div>
        {/* Running time */}
        <div className="flex flex-col gap-0.5 border-r px-6">
          <div className="flex items-center gap-1.5">
            <Clock size={16} />
            <span className="text-upper text-xs">{t("runningTime")}</span>
          </div>
          <p className="text-base font-medium">{"30 ~ 45 minutes"}</p>
        </div>
        {/* Executed Jobs */}
        <div className="flex flex-col gap-0.5 border-r px-6">
          <div className="flex items-center gap-1.5">
            <CircleCheck size={16} />
            <span className="text-upper text-xs">{t("executedJobs")}</span>
          </div>
          <p className="text-base font-medium">{"120 Tsd."}</p>
        </div>
        {/* Last Updated */}
        <div className="flex flex-col gap-0.5 px-6">
          <div className="flex items-center gap-1.5">
            <RefreshCcw size={16} />
            <span className="text-xs uppercase">{t("lastUpdated")}</span>
          </div>
          <p className="text-base font-medium">
            {dateFormatter.relativeTime(agent.updatedAt, new Date())}
          </p>
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection2 };
