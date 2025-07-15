"use client";

import { useState } from "react";

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

  return (
    <ScrollArea className="w-full">
      <div
        className="flex items-center justify-center gap-4"
        onMouseEnter={() => setFocused(true)}
      >
        {agents.map((agent, index) => (
          <AgentShowcaseCard
            key={agent.id}
            agentId={agent.id}
            name={getAgentName(agent)}
            description={getAgentDescription(agent)}
            image={getAgentResolvedImage(agent)}
            isExpanded={!focused && index === 0}
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
