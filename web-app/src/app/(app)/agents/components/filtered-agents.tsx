"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import {
  AgentWithCreditsPrice,
  AgentWithRelations,
  getAgentTags,
} from "@/lib/db";
import type { AgentRatingStats } from "@/lib/db/repositories/agentRating.repository";

import { GalleryFilterState } from "./use-gallery-filter";

const filterAgents = (
  agents: AgentWithCreditsPrice[],
  { query, tags }: GalleryFilterState,
) => {
  if (!query && tags.length === 0) {
    return agents;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return agents.filter((agent) => {
    // Query matching
    const matchesQuery =
      !normalizedQuery ||
      [agent.name, agent.description ?? ""].some((text) =>
        text.toLowerCase().includes(normalizedQuery),
      );

    // Tag matching
    const matchesTags =
      tags.length === 0 ||
      tags.some((tag) => getAgentTags(agent).includes(tag));

    return matchesQuery && matchesTags;
  });
};

interface FilteredAgentsProps {
  agents: AgentWithCreditsPrice[];
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStatsMap: Record<string, AgentRatingStats>;
}

export default function FilteredAgents(props: FilteredAgentsProps) {
  return (
    <Suspense>
      <FilteredAgentsInner {...props} />
    </Suspense>
  );
}

function FilteredAgentsInner({
  agents,
  favoriteAgents,
  ratingStatsMap,
}: FilteredAgentsProps) {
  const searchParams = useSearchParams();

  const filteredAgents = useMemo(() => {
    const criteria: GalleryFilterState = {
      query: searchParams.get("query") ?? "",
      tags: searchParams.get("tags")?.split(",").filter(Boolean) ?? [],
    };

    return filterAgents(agents, criteria);
  }, [agents, searchParams]);

  if (!agents.length) {
    return <AgentsNotAvailable />;
  }

  if (!filteredAgents.length) {
    return <AgentsNotFound />;
  }

  return (
    <Agents
      agents={filteredAgents}
      favoriteAgents={favoriteAgents}
      ratingStatsMap={ratingStatsMap}
    />
  );
}
