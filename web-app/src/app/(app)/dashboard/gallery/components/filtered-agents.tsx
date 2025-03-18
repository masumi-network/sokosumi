"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface FilterCriteria {
  query: string;
  tags: string[];
}

const filterAgents = (agents: AgentDTO[], { query, tags }: FilterCriteria) => {
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
      tags.length === 0 || tags.every((tag) => agent.tags.includes(tag));

    return matchesQuery && matchesTags;
  });
};

interface FilteredAgentsProps {
  agents: AgentDTO[];
}

export default function FilteredAgents({ agents }: FilteredAgentsProps) {
  const searchParams = useSearchParams();

  const filteredAgents = useMemo(() => {
    const criteria: FilterCriteria = {
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
    <Agents agents={filteredAgents} agentCardHrefPrefix="/dashboard/gallery" />
  );
}
