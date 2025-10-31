"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useMemo } from "react";
import type {
  AgentRatingStats,
  AgentWithCreditsPrice,
  AgentWithRelations,
} from "@sokosumi/database";

import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategories } from "@/lib/helpers/agent";
import type { Category } from "@/lib/types/category";
import { isAgentNew } from "@/lib/utils/agent";

import {
  AgentCategoryGroup,
  groupAgentsByCategory,
} from "./group-agents-by-category";
import { GalleryFilterState } from "./use-gallery-filter";

const filterAgents = (
  agents: AgentWithCreditsPrice[],
  { query, categories }: GalleryFilterState,
) => {
  if (!query && categories.length === 0) {
    return agents;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return agents.filter((agent) => {
    // Query matching
    const matchesQuery =
      !normalizedQuery ||
      [agent.name, agent.description ?? ""].some((text) =>
        text.toLowerCase().includes(normalizedQuery),
      );

    // Category matching (supports special slugs)
    const agentCategories = getAgentCategories(agent);
    const selected = new Set(categories);
    const realCategorySlugs = categories.filter(
      (s) =>
        s !== AGENT_CATEGORY_SLUGS.NEW && s !== AGENT_CATEGORY_SLUGS.OTHERS,
    );

    const matchesRealCategories =
      realCategorySlugs.length > 0 &&
      realCategorySlugs.some((slug) => agentCategories.includes(slug));

    const isNew = isAgentNew(agent);
    const matchesNew = selected.has(AGENT_CATEGORY_SLUGS.NEW) && isNew === true;
    const isFeatured = agentCategories.includes(AGENT_CATEGORY_SLUGS.FEATURED);
    const matchesOthers =
      selected.has(AGENT_CATEGORY_SLUGS.OTHERS) &&
      agentCategories.length === 0 &&
      !isNew &&
      !isFeatured;

    const matchesCategories =
      categories.length === 0 ||
      matchesRealCategories ||
      matchesNew ||
      matchesOthers;

    return matchesQuery && matchesCategories;
  });
};

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
  const t = useTranslations("App.Agents.FilterSection");
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

  const getCategoryDisplayName = (group: AgentCategoryGroup): string => {
    if (group.categorySlug === AGENT_CATEGORY_SLUGS.FEATURED) {
      return t("featuredAgents");
    }
    if (group.categorySlug === AGENT_CATEGORY_SLUGS.NEW) {
      return t("newAgents");
    }
    if (group.categorySlug === null) {
      return t("others");
    }
    return group.categoryName;
  };

  return (
    <div className="flex flex-col gap-12">
      {groupedAgents.map((group) => (
        <div
          key={group.categorySlug ?? AGENT_CATEGORY_SLUGS.OTHERS}
          className="flex flex-col gap-4"
        >
          <CategoryHeading
            group={group}
            getCategoryDisplayName={getCategoryDisplayName}
          />
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
  getCategoryDisplayName: (group: AgentCategoryGroup) => string;
}

function CategoryHeading({
  group,
  getCategoryDisplayName,
}: CategoryHeadingProps) {
  return (
    <h2 className="text-xl font-light md:text-2xl">
      {getCategoryDisplayName(group)}
    </h2>
  );
}

export function CategoryHeadingSkeleton() {
  return <Skeleton className="h-6 w-32 md:h-7 md:w-40" />;
}
