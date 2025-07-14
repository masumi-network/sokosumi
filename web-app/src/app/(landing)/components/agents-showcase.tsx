import Image from "next/image";
import { useTranslations } from "next-intl";
import React, { Suspense } from "react";

import { AgentDetailLink } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgentResolvedImage } from "@/lib/db";
import { getAvailableAgents } from "@/lib/services";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agentId: string;
  name: string;
  description: string | null;
  image?: string;
}

const AgentShowcaseCard = ({
  agentId,
  name,
  description,
  image,
}: AgentCardProps) => {
  const t = useTranslations("Landing.Page.Hero.AgentsShowcase");

  return (
    <div
      className={cn(
        "bg-background/20 group flex h-[90px] w-[300px] items-center overflow-hidden rounded-lg shadow-md transition-all duration-300 hover:w-[300px] md:w-[90px]",
      )}
    >
      <div className="relative h-[90px] w-[90px] shrink-0">
        <Image
          src={image ?? "/images/placeholder.svg"}
          alt={name}
          className="object-cover"
          fill
          sizes="90px"
        />
      </div>
      <div className="w-[210px] px-3 opacity-100 transition-opacity duration-300 group-hover:opacity-100">
        <h3 className="mb-1 truncate text-sm font-bold">{name}</h3>
        {description && (
          <p className="text-foreground mb-2 w-full truncate text-xs">
            {description}
          </p>
        )}
        <Button variant="secondary" size="sm" asChild>
          <AgentDetailLink agentId={agentId}>{t("viewAgent")}</AgentDetailLink>
        </Button>
      </div>
    </div>
  );
};

const AgentCardSkeleton = () => {
  return <Skeleton className="h-[90px] w-[300px] rounded-md md:w-[90px]" />;
};

async function AgentsShowcaseList() {
  const agents = await getAvailableAgents();
  const firstFiveAgents = agents.slice(0, 5);

  return (
    <ScrollArea className="w-full">
      <div className="flex items-center justify-center gap-4">
        {firstFiveAgents.map((agent) => (
          <AgentShowcaseCard
            key={agent.id}
            agentId={agent.id}
            name={agent.name}
            description={agent.description}
            image={getAgentResolvedImage(agent)}
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
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
