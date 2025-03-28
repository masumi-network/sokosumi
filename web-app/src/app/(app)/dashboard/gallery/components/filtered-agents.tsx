"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { AgentListWithAgent } from "@/lib/db/services/agentList.service";

import { FilterState } from "./use-gallery-filter";

const filterAgents = (agents: AgentDTO[], { query, tags }: FilterState) => {
  if (!query && tags.length === 0) {
    return agents;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return agents.filter((agent) => {
    // Query matching
    const matchesQuery =
      !normalizedQuery ||
      [agent.name, agent.description || ""].some((text) =>
        text.toLowerCase().includes(normalizedQuery),
      );

    // Tag matching
    const matchesTags =
      tags.length === 0 || tags.some((tag) => agent.tags.includes(tag));

    return matchesQuery && matchesTags;
  });
};

interface FilteredAgentsProps {
  agents: AgentDTO[];
  agentList?: AgentListWithAgent | undefined;
}

function FilteredAgents({ agents, agentList }: FilteredAgentsProps) {
  const searchParams = useSearchParams();

  const filteredAgents = useMemo(() => {
    const criteria: FilterState = {
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

  return <Agents agents={filteredAgents} agentList={agentList} />;
}

export default FilteredAgents;
