"use client";

import type {
  AgentRatingStats,
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { CarouselItem } from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

import { AgentCard, AgentCardSkeleton } from "./agent-card";
import { AgentCarousel } from "./agent-carousel";

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
    <div className={cn("w-full", className)}>
      {/* Mobile Skeleton */}
      <div className="md:hidden">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-h-[317px] shrink-0 basis-full">
              <AgentCardSkeleton />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Skeleton */}
      <div className="hidden [-ms-overflow-style:none] [scrollbar-width:none] md:flex md:gap-6 md:overflow-x-auto md:pb-4 [&::-webkit-scrollbar]:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="min-h-[317px] shrink-0">
            <AgentCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

interface AgentsProps {
  agents: AgentWithCreditsPrice[];
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStatsMap: Record<string, AgentRatingStats>;
  className?: string | undefined;
  agentCardClassName?: string | undefined;
  title?: string;
}

function Agents({
  agents,
  favoriteAgents,
  ratingStatsMap,
  className,
  agentCardClassName,
  title,
}: AgentsProps) {
  return (
    <AgentCarousel
      className={className}
      itemCount={agents.length}
      itemIds={agents.map((agent) => agent.id)}
      title={title}
    >
      {agents.map((agent) => (
        <CarouselItem
          key={agent.id}
          className="basis-full md:basis-auto md:pr-2"
        >
          <AgentCard
            agent={agent}
            favoriteAgents={favoriteAgents}
            ratingStats={ratingStatsMap[agent.id]}
            className={agentCardClassName}
          />
        </CarouselItem>
      ))}
    </AgentCarousel>
  );
}

export { Agents, AgentsNotAvailable, AgentsNotFound, AgentsSkeleton };
