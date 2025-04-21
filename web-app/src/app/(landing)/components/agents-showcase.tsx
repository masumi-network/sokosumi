import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import React, { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { getAgentResolvedImage, getAgents } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  name: string;
  description: string | null;
  image?: string;
  id: string;
}

const AgentShowcaseCard = ({
  name,
  description,
  image,
  id,
}: AgentCardProps) => {
  const t = useTranslations("Landing.Page.Hero.AgentsShowcase");

  return (
    <div
      className={cn(
        "bg-background/20 group flex h-[90px] w-[90px] items-center overflow-hidden rounded-lg shadow-md transition-all duration-300 hover:w-[300px]",
      )}
    >
      <Image
        src={image ?? "/placeholder.svg"}
        alt={name}
        width={90}
        height={90}
        className="shrink-0 object-cover"
      />
      <div className="w-[210px] px-3 opacity-100 transition-opacity duration-300 group-hover:opacity-100">
        <h3 className="mb-1 truncate text-sm font-bold">{name}</h3>
        {description && (
          <p className="text-foreground mb-2 w-full truncate text-xs">
            {description}
          </p>
        )}
        <Link href={`/agents/${id}`}>
          <Button variant="default" size="sm">
            {t("viewAgent")}
          </Button>
        </Link>
      </div>
    </div>
  );
};

const AgentCardSkeleton = () => {
  return (
    <div className="bg-secondary h-[88px] w-[88px] animate-pulse rounded-lg" />
  );
};

async function AgentsShowcaseList() {
  const agents = await getAgents();
  const firstFiveAgents = agents.slice(0, 5);

  return (
    <div className="flex items-center gap-4">
      {firstFiveAgents.map((agent) => (
        <AgentShowcaseCard
          key={agent.id}
          id={agent.id}
          name={agent.name}
          description={agent.description}
          image={getAgentResolvedImage(agent)}
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
        <AgentsShowcaseList />
      </Suspense>
    </div>
  );
}
