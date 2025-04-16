import { useTranslations } from "next-intl";

import { AgentListWithAgent, AgentWithRelations, CreditsPrice } from "@/lib/db";
import { cn } from "@/lib/utils";

import { AgentCard, AgentCardSkeleton } from "./agent-card";

function AgentsNotAvailable(): React.JSX.Element {
  const t = useTranslations("Components.Agents");

  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground text-lg">
          {t("agentsNotAvailable")}
        </p>
      </div>
    </div>
  );
}

function AgentsNotFound() {
  const t = useTranslations("Components.Agents");

  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground text-lg">{t("agentsNotFound")}</p>
      </div>
    </div>
  );
}

interface AgentsSkeletonProps {
  className?: string;
}

function AgentsSkeleton({ className }: AgentsSkeletonProps) {
  return (
    <div
      className={cn("flex w-full flex-wrap justify-center gap-6", className)}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <AgentCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface AgentsProps {
  agents: AgentWithRelations[];
  agentList?: AgentListWithAgent | undefined;
  className?: string | undefined;
  agentCardClassName?: string | undefined;
  agentCreditsPriceList: CreditsPrice[];
}

function Agents({
  agents,
  agentList,
  className,
  agentCardClassName,
  agentCreditsPriceList,
}: AgentsProps) {
  return (
    <div
      className={cn("flex w-full flex-wrap justify-center gap-6", className)}
    >
      {agents.map((agent, index) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          agentList={agentList}
          agentCreditsPrice={agentCreditsPriceList[index]}
          className={agentCardClassName}
        />
      ))}
    </div>
  );
}

export { Agents, AgentsNotAvailable, AgentsNotFound, AgentsSkeleton };
