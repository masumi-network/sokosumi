import Image from "next/image";
import Link from "next/link";
import React, { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { getAgentResolvedImage, getAgents } from "@/lib/db";

interface AgentCardProps {
  name: string;
  description: string | null;
  image?: string;
  id: string;
  isActive: boolean;
}

const AgentCard = ({
  name,
  description,
  image,
  id,
  isActive,
}: AgentCardProps) => {
  return (
    <div
      className={`bg-background/20 group flex h-[90px] items-center overflow-hidden rounded-lg shadow-[0_0_15px_#fff4] backdrop-blur-sm transition-all duration-300 hover:w-[300px] ${isActive ? "w-[300px]" : "w-[90px]"}`}
    >
      <Image
        src={image ?? "/placeholder.svg"}
        alt={name}
        width={90}
        height={90}
        className="shrink-0 object-cover"
      />
      <div
        className={`w-full max-w-[210px] px-3 transition-opacity duration-300 ${isActive ? "opacity-0" : "opacity-100 group-hover:opacity-100"}`}
      >
        <h3 className="mb-1 truncate text-sm font-bold">{name}</h3>
        {description && (
          <p className="text-foreground mb-2 w-full truncate text-xs">
            {description}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="bg-background/20 text-foreground hover:text-foreground hover:bg-background/30 dark:bg-quinary dark:hover:bg-quinary/80 text-xs"
        >
          <Link href={`/agents/${id}`}>{"View Agent"}</Link>
        </Button>
      </div>
    </div>
  );
};

const AgentCardSkeleton = () => {
  return (
    <div className="bg-secondary h-[88px] w-[88px] animate-pulse rounded-lg" />
  );
};

async function AgentsList() {
  const agents = await getAgents();
  const firstFiveAgents = agents.slice(0, 5);

  return (
    <div className="flex items-center gap-4">
      {firstFiveAgents.map((agent) => (
        <AgentCard
          key={agent.id}
          id={agent.id}
          name={agent.name}
          description={agent.description}
          image={getAgentResolvedImage(agent)}
          isActive={false}
        />
      ))}
    </div>
  );
}

function ShowcaseSkeleton() {
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
    <div className="absolute bottom-0 left-0 flex w-full items-center justify-center gap-4 px-12 py-6">
      <Suspense fallback={<ShowcaseSkeleton />}>
        <AgentsList />
      </Suspense>
    </div>
  );
}
