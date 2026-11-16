"use client";

import { useTranslations } from "next-intl";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import FilterSection from "@/app/agents/components/filter-section";
import {
  Agents,
  AgentsNotAvailable,
  AgentsNotFound,
} from "@/components/agents/agents";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import { setAgentStar } from "@/lib/actions/agent/set-agent-star";
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
  starredAgentIds: string[];
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
  starredAgentIds,
}: FilteredAgentsProps) {
  const t = useTranslations("Components.Agents");
  const { query, categories: selectedCategories, kind } = useGalleryFilter();
  // Saved stars, and the wanted value of each save still running.
  const [savedIds, setSavedIds] = useState(() => new Set(starredAgentIds));
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const starredIds = useMemo(() => {
    const shown = new Set(savedIds);
    for (const [id, on] of pending) {
      if (on) shown.add(id);
      else shown.delete(id);
    }
    return shown;
  }, [savedIds, pending]);
  const pendingStarIds = useMemo(() => new Set(pending.keys()), [pending]);

  // Optimistic, one save per Agent at a time. A failed or thrown save drops
  // the pending value, so the card falls back to the saved state.
  const toggleStar = async (agentId: string) => {
    if (pending.has(agentId)) return;
    const on = !starredIds.has(agentId);
    const setPendingFor = (value: boolean | null) =>
      setPending((current) => {
        const next = new Map(current);
        if (value === null) next.delete(agentId);
        else next.set(agentId, value);
        return next;
      });
    setPendingFor(on);
    const saved = await setAgentStar(agentId, on).then(
      (result) => result.ok,
      () => false,
    );
    if (saved) {
      setSavedIds((current) => {
        const next = new Set(current);
        if (on) next.add(agentId);
        else next.delete(agentId);
        return next;
      });
    } else {
      toast.error(t("starFailed"));
    }
    setPendingFor(null);
  };

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

  // Filters apply to Starred too, so a search narrows the whole page.
  const starredAgents = filteredAgents.filter((agent) =>
    starredIds.has(agent.id),
  );
  const starProps = { starredIds, pendingStarIds, onToggleStar: toggleStar };

  if (!agents.length) {
    return <AgentsNotAvailable />;
  }

  return (
    <div className="flex flex-col gap-12">
      {/* Keep filter chrome mounted on empty matches so kind/search stay usable. */}
      <FilterSection categories={categories} />
      {!filteredAgents.length ? (
        <AgentsNotFound />
      ) : (
        <>
          {starredAgents.length ? (
            <Agents
              agents={starredAgents}
              ratingStatsMap={ratingStatsMap}
              title={t("starredCategory")}
              {...starProps}
            />
          ) : null}
          {groupedAgents.map((group) => (
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
              {...starProps}
            />
          ))}
        </>
      )}
    </div>
  );
}
