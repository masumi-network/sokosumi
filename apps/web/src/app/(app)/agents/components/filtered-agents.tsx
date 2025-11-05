"use client";

import type {
  AgentRatingStats,
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/database";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category } from "@/lib/types/category";

import { filterAgents } from "./filter-agents";
import {
  AgentCategoryGroup,
  groupAgentsByCategory,
} from "./group-agents-by-category";
import { GalleryFilterState } from "./use-gallery-filter";

interface FilteredAgentsProps {
  agents: AgentWithCreditsPrice[];
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStatsMap: Record<string, AgentRatingStats>;
  categories: Category[];
}

export default function FilteredAgents(props: FilteredAgentsProps) {
  return (
    <Suspense>
      <FilteredAgentsInner {...props} />
    </Suspense>
  );
}

function FilteredAgentsInner({
  agents,
  favoriteAgents,
  ratingStatsMap,
  categories,
}: FilteredAgentsProps) {
  const searchParams = useSearchParams();

  const filteredAgents = useMemo(() => {
    const criteria: GalleryFilterState = {
      query: searchParams.get("query") ?? "",
      categories:
        searchParams.get("categories")?.split(",").filter(Boolean) ?? [],
    };

    return filterAgents(agents, criteria);
  }, [agents, searchParams]);

  const groupedAgents = useMemo(() => {
    return groupAgentsByCategory(filteredAgents, categories);
  }, [filteredAgents, categories]);

  if (!agents.length) {
    return <AgentsNotAvailable />;
  }

  if (!filteredAgents.length) {
    return <AgentsNotFound />;
  }

  return (
    <div className="flex flex-col gap-12">
      {groupedAgents.map((group) => (
        <div key={group.categorySlug} className="flex flex-col gap-4">
          <CategoryHeading group={group} />
          <Agents
            agents={group.agents}
            favoriteAgents={favoriteAgents}
            ratingStatsMap={ratingStatsMap}
          />
        </div>
      ))}
    </div>
  );
}

interface CategoryHeadingProps {
  group: AgentCategoryGroup;
}

function CategoryHeading({ group }: CategoryHeadingProps) {
  return (
    <h2 className="text-xl font-light md:text-2xl">{group.categoryName}</h2>
  );
}

export function CategoryHeadingSkeleton() {
  return <Skeleton className="h-6 w-32 md:h-7 md:w-40" />;
}
