"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { getTags } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/types/agent.types";
import { AgentListWithAgent } from "@/lib/db/types/agentList.types";
import { CreditsPrice } from "@/lib/db/types/credit.type";

import { GalleryFilterState } from "./use-gallery-filter";

const filterAgents = (
  agents: AgentWithRelations[],
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
      tags.length === 0 || tags.some((tag) => getTags(agent).includes(tag));

    return matchesQuery && matchesTags;
  });
};

interface FilteredAgentsProps {
  agents: AgentWithRelations[];
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPriceList: CreditsPrice[];
}

function FilteredAgents({
  agents,
  agentList,
  agentCreditsPriceList,
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
      agentList={agentList}
      agentCreditsPriceList={agentCreditsPriceList}
    />
  );
}

export default FilteredAgents;
