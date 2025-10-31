import type { AgentRatingStats } from "@sokosumi/database";
import { AgentWithCreditsPrice, AgentWithRelations } from "@sokosumi/database";
import { useTranslations } from "next-intl";

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
      className={cn(
        "flex flex-wrap justify-center gap-3 space-y-4 md:justify-between",
        className,
      )}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <AgentCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface AgentsProps {
  agents: AgentWithCreditsPrice[];
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStatsMap: Record<string, AgentRatingStats>;
  className?: string | undefined;
  agentCardClassName?: string | undefined;
}

function Agents({
  agents,
  favoriteAgents,
  ratingStatsMap,
  className,
  agentCardClassName,
}: AgentsProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-center gap-3 space-y-4 md:justify-between",
        className,
      )}
    >
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          favoriteAgents={favoriteAgents}
          ratingStats={ratingStatsMap[agent.id]}
          className={agentCardClassName}
        />
      ))}
    </div>
  );
}

export { Agents, AgentsNotAvailable, AgentsNotFound, AgentsSkeleton };
