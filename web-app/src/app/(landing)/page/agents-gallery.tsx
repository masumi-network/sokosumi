import { Suspense } from "react";

import AgentCard, { AgentCardSkeleton } from "@/components/agent-card";
import {
  getAverageRating,
  getCredits,
  getDescription,
  getImageUrl,
  getName,
  getTags,
} from "@/lib/db/agent/agent-helper";
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
          name={getName(agent)}
          description={getDescription(agent) ?? ""}
          averageStars={getAverageRating(agent)}
          image={getImageUrl(agent)}
          price={getCredits(agent)}
          tags={getTags(agent)}
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
