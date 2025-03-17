"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import Agents, { AgentsNotFound, EmptyGallery } from "@/components/agents";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

const filterAgent = (agent: AgentDTO, query: string, tags: string[]) => {
  const queryIncluded =
    !query ||
    agent.name.toLowerCase().includes(query.toLowerCase()) ||
    (agent.description || "").toLowerCase().includes(query.toLowerCase());
  const tagIncluded =
    tags.length == 0 || tags.some((tag) => agent.tags.includes(tag));

  return queryIncluded && tagIncluded;
};

interface FilteredAgentsProps {
  agents: AgentDTO[];
}

export default function FilteredAgents({ agents }: FilteredAgentsProps) {
  const searchParams = useSearchParams();

  const filteredAgents = useMemo(() => {
    const query = searchParams.get("query") ?? "";
    const tags = searchParams.get("tags")?.split(",") ?? [];
    return agents.filter((agent) => filterAgent(agent, query, tags));
  }, [agents, searchParams]);

  if (!agents.length) {
    return <EmptyGallery />;
  }

  if (!filteredAgents.length) {
    return <AgentsNotFound />;
  }

  return <Agents agents={filteredAgents} />;
}
