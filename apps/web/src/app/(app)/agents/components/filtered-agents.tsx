"use client";

import { Suspense, useMemo } from "react";
import FilterSection from "@/app/agents/components/filter-section";
import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { Skeleton } from "@/components/ui/skeleton";
import useGalleryFilter, {
  type GalleryFilterState,
} from "@/hooks/use-gallery-filter";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { filterAgents } from "@/lib/helpers/agent-filter";
import { groupAgentsByCategory } from "@/lib/helpers/agent-grouping";
import type { Category } from "@/lib/types/category";
import type { AgentRatingStats } from "@/lib/types/core-dto";

interface FilteredAgentsProps {
  agents: CatalogBrowseAgent[];
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
  ratingStatsMap,
  categories,
}: FilteredAgentsProps) {
  const { query, categories: selectedCategories, kind } = useGalleryFilter();

  const filteredAgents = useMemo(() => {
    const criteria: GalleryFilterState = {
      query,
      categories: selectedCategories,
      kind,
    };

    return filterAgents(agents, criteria);
  }, [agents, query, selectedCategories, kind]);

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
      <FilterSection categories={categories} />
      {groupedAgents.map((group) => (
        <Agents
          key={group.categorySlug}
          agents={group.agents}
          icon={group.categoryIcon}
          ratingStatsMap={ratingStatsMap}
          title={group.categoryName}
        />
      ))}
    </div>
  );
}

export function CategoryHeadingSkeleton() {
  return <Skeleton className="h-6 w-32 md:h-7 md:w-40" />;
}
