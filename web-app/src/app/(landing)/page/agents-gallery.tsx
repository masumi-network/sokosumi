import { Suspense } from "react";

import AgentCard, { AgentCardSkeleton } from "@/components/agent-card";
import { AgentDTO } from "@/lib/agent/AgentDTO";
import { prisma } from "@/lib/prisma";

import HorizontalScroll from "../components/horizontal-scroll";

async function AgentsList() {
  const agents = await prisma.agent.findMany({
    include: {
      Pricing: {
        include: { FixedPricing: { include: { Amounts: true } } },
      },
      ExampleOutput: true,
      ExampleOutputOverride: true,
      Rating: true,
      UserAgentRating: true,
    },
  });
  if (!agents) {
    throw new Error("Agent not found");
  }

  const agentsDTO = agents.map((agent) => new AgentDTO(agent));
  return (
    <HorizontalScroll itemClassName="h-[32rem] w-[24rem]">
      {agentsDTO.map((agent) => (
        <AgentCard
          key={agent.id}
          id={agent.id}
          name={agent.name}
          description={agent.description ?? ""}
          averageStars={agent.Rating.averageStars}
          image={agent.image}
          price={agent.Pricing.credits}
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
