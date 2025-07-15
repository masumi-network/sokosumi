"use client";

import { useMemo, useState } from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  AgentWithRelations,
  getAgentDescription,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";

import AgentShowcaseCard from "./agent-showcase-card";

interface AgentsShowcaseClientProps {
  agents: AgentWithRelations[];
}

export default function AgentsShowcaseClient({
  agents,
}: AgentsShowcaseClientProps) {
  const [focused, setFocused] = useState(false);

  const firstAgent = agents[0];
  const otherAgents = agents.slice(1);

  const FirstAgentShowcaseCard = firstAgent && (
    <AgentShowcaseCard
      agentId={firstAgent.id}
      name={getAgentName(firstAgent)}
      description={getAgentDescription(firstAgent)}
      image={getAgentResolvedImage(firstAgent)}
      isExpanded={!focused}
    />
  );

  const OtherAgentsShowcaseCards = useMemo(() => {
    return otherAgents.map((agent) => (
      <AgentShowcaseCard
        key={agent.id}
        agentId={agent.id}
        name={getAgentName(agent)}
        description={getAgentDescription(agent)}
        image={getAgentResolvedImage(agent)}
      />
    ));
  }, [otherAgents]);

  return (
    <ScrollArea className="w-full">
      <div
        className="flex items-center justify-center gap-4"
        onMouseEnter={() => setFocused(true)}
      >
        {FirstAgentShowcaseCard}
        {OtherAgentsShowcaseCards}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
