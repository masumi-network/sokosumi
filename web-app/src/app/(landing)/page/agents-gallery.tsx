import { Suspense } from "react";

import { AgentCard, AgentCardSkeleton } from "@/components/agents";
import { getCachedAgents } from "@/lib/db/services/agent.service";

import HorizontalScroll from "../components/horizontal-scroll";

async function AgentsList() {
  const agents = await getCachedAgents();
  return (
    <HorizontalScroll>
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          className="h-[32rem] w-[24rem]"
        />
      ))}
    </HorizontalScroll>
  );
}

function AgentsGallerySkeleton() {
  return (
    <HorizontalScroll>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <AgentCardSkeleton key={i} className="h-[32rem] w-[24rem]" />
      ))}
    </HorizontalScroll>
  );
}

export default function AgentsGallery() {
  return (
    <Suspense fallback={<AgentsGallerySkeleton />}>
      <AgentsList />
    </Suspense>
  );
}
