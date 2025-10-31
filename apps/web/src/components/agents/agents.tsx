"use client";

import type {
  AgentRatingStats,
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/database";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
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
}

function Agents({
  agents,
  favoriteAgents,
  ratingStatsMap,
  className,
  agentCardClassName,
}: AgentsProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) {
      return;
    }

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap());
    };

    api.on("select", handleSelect);

    requestAnimationFrame(() => {
      handleSelect();
    });

    return () => {
      api.off("select", handleSelect);
    };
  }, [api]);

  return (
    <div className={cn("w-full", className)}>
      {/* Mobile Carousel */}
      <div className="md:hidden">
        <Carousel setApi={setApi} className="w-full">
          <CarouselContent>
            {agents.map((agent) => (
              <CarouselItem key={agent.id} className="basis-full">
                <AgentCard
                  agent={agent}
                  favoriteAgents={favoriteAgents}
                  ratingStats={ratingStatsMap[agent.id]}
                  className={agentCardClassName}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
        {/* Dots Indicator */}
        {agents.length > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            {agents.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to slide ${index + 1}`}
                onClick={() => api?.scrollTo(index)}
                className={cn(
                  "size-2 rounded-full transition-all",
                  current === index ? "bg-primary" : "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop Horizontal Scroll */}
      <div className="hidden [-ms-overflow-style:none] [scrollbar-width:none] md:flex md:gap-6 md:overflow-x-auto md:pb-4 [&::-webkit-scrollbar]:hidden">
        {agents.map((agent) => (
          <div key={agent.id} className="shrink-0">
            <AgentCard
              agent={agent}
              favoriteAgents={favoriteAgents}
              ratingStats={ratingStatsMap[agent.id]}
              className={agentCardClassName}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { Agents, AgentsNotAvailable, AgentsNotFound, AgentsSkeleton };
