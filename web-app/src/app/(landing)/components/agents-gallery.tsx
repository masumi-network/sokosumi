import { Suspense } from "react";

import HorizontalScroll from "@/app/(landing)/components/horizontal-scroll";
import { AgentCard, AgentCardSkeleton } from "@/components/agents";
import { getAgents } from "@/lib/db/services/agent.service";

async function AgentsList() {
  const agents = await getAgents();
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
