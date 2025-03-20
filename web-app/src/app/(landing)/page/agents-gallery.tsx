import { Suspense } from "react";

import AgentCard, { AgentCardSkeleton } from "@/components/agent-card";
import { getCachedAgents } from "@/lib/db/services/agent.service";

import HorizontalScroll from "../components/horizontal-scroll";

async function AgentsList() {
  const agents = await getCachedAgents();
  return (
    <HorizontalScroll itemClassName="h-[32rem] w-[24rem]">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          id={agent.id}
          name={agent.name}
          description={agent.description}
          averageStars={agent.averageStars}
          image={agent.image}
          price={agent.credits}
          tags={agent.tags}
        />
      ))}
    </HorizontalScroll>
  );
}

function AgentsGallerySkeleton() {
  return (
    <HorizontalScroll itemClassName="h-[32rem] w-[24rem]">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <AgentCardSkeleton key={i} />
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
