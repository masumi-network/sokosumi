"use client";

import { useTranslations } from "next-intl";
import { Suspense, useMemo } from "react";
import FilterSection from "@/app/agents/components/filter-section";
import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents/agents";
import { GalleryGroupHeading } from "@/components/agents/gallery-group-heading";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import type { GalleryFilterState } from "@/lib/agents/gallery-filter";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { filterAgents } from "@/lib/helpers/agent-filter";
import { groupAgentsByCategory } from "@/lib/helpers/agent-grouping";
import type { Category } from "@/lib/types/category";
import type { AgentRatingStats } from "@/lib/types/core-dto";

interface FilteredAgentsProps {
  agents: CatalogBrowseAgent[];
  ratingStatsMap: Record<string, AgentRatingStats>;
  categories: Category[];
  title: string;
  subtitle: string;
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
  title,
  subtitle,
}: FilteredAgentsProps) {
  const t = useTranslations("Components.Agents");
  const {
    query,
    scope,
    categories: selectedCategories,
    kind,
  } = useGalleryFilter();

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

  if (scope === "coworkers") {
    return null;
  }

  return (
    <section className="space-y-8">
      <GalleryGroupHeading
        title={title}
        subtitle={subtitle}
        count={query.trim() ? filteredAgents.length : undefined}
      />
      <div className="flex flex-col gap-12">
        {/* Keep filter chrome mounted on empty matches so kind/search stay usable. */}
        <FilterSection categories={categories} />
        {!filteredAgents.length ? (
          <AgentsNotFound />
        ) : (
          groupedAgents.map((group) => (
            <Agents
              key={group.categorySlug}
              agents={group.agents}
              icon={group.categoryIcon}
              ratingStatsMap={ratingStatsMap}
              title={
                group.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT
                  ? t("othersCategory")
                  : group.categoryName
              }
            />
          ))
        )}
      </div>
    </section>
  );
}
