import React, { Suspense } from "react";

import { getAvailableAgents } from "@/lib/services";

import { AgentCardSkeleton } from "./agent-showcase-card";
import AgentsShowcaseClient from "./agents-showcase.client";

async function AgentsShowcaseList() {
  const agents = await getAvailableAgents();
  const firstFiveAgents = agents.slice(0, 5);

  return <AgentsShowcaseClient agents={firstFiveAgents} />;
}

function AgentsShowcaseSkeleton() {
  return (
    <div className="flex items-center gap-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <AgentCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default function AgentsShowcase() {
  return (
    <div className="absolute bottom-0 left-0 z-10 flex w-full items-center justify-center gap-4 px-4 py-6 md:px-12">
      <Suspense fallback={<AgentsShowcaseSkeleton />}>
        <AgentsShowcaseList />
      </Suspense>
    </div>
  );
}
