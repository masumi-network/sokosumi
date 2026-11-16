import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
} from "@/app/tasks/components/create-task-modal";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { AgentsNotAvailable, AgentsSkeleton } from "@/components/agents/agents";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import {
  GALLERY_PAGE_SECTIONS_CLASS,
  GALLERY_SECTION_HEADLINE_CLASS,
} from "@/components/agents/gallery-page-classes";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { Skeleton } from "@/components/ui/skeleton";
import { mapAgentListItemToCatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { mapCoreCategoriesToCategories } from "@/lib/agents/core-dto-mappers";
import type { AgentRatingStats } from "@/lib/types/core-dto";

import { loadAgentsCatalog, loadAgentsCoworkers } from "./agents-page-data";
import FilteredAgents from "./components/filtered-agents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function CoworkersTierFallback() {
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56 md:h-8" />
        <Skeleton className="h-4 w-80 md:h-5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </section>
  );
}

function AgentsCatalogFallback() {
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 md:h-8" />
        <Skeleton className="h-4 w-72 md:h-5" />
      </div>
      <AgentsSkeleton />
    </section>
  );
}

async function CoworkersTier() {
  const coworkers = await loadAgentsCoworkers();
  const coworkerOptions = getCoworkerOptions(coworkers);

  return (
    <CreateTaskModalProvider>
      <CoworkerGallerySection coworkers={coworkers} />
      <CreateTaskModal coworkerOptions={coworkerOptions} />
    </CreateTaskModalProvider>
  );
}

/**
 * Tier 2 — full catalog streams after Tier 1 paints so LCP is the coworker
 * gallery, not a blocked wait on every catalog page.
 *
 * Catalog loaders are cookie-free (`'use cache'`) and share across users at
 * runtime. They load through a browser-only cache, so a link prefetch carries
 * the catalog and a build with Core unreachable bakes nothing in.
 * Translations also need request locale via cookies/headers.
 */
async function AllAgentsTier() {
  const [[listItems, categories], t] = await Promise.all([
    loadAgentsCatalog(),
    getTranslations("App.Agents"),
  ]);

  const agents = listItems.map(mapAgentListItemToCatalogBrowseAgent);

  if (!agents.length) {
    return <AgentsNotAvailable />;
  }

  const mappedCategories = mapCoreCategoriesToCategories(categories);
  const ratingStatsMap: Record<string, AgentRatingStats> = Object.fromEntries(
    agents.map((agent) => [agent.id, agent.metrics.ratings]),
  );

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h2 className={GALLERY_SECTION_HEADLINE_CLASS}>
          {t("allAgentsTitle")}
        </h2>
        <p className="text-muted-foreground text-sm md:text-base">
          {t("allAgentsSubtitle")}
        </p>
      </div>
      <FilteredAgents
        agents={agents}
        ratingStatsMap={ratingStatsMap}
        categories={mappedCategories}
      />
    </section>
  );
}

export default function GalleryPage() {
  return (
    <div className="w-full">
      <RefreshPrefetchedPage />
      <div className={GALLERY_PAGE_SECTIONS_CLASS}>
        <Suspense fallback={<CoworkersTierFallback />}>
          <CoworkersTier />
        </Suspense>

        <Suspense fallback={<AgentsCatalogFallback />}>
          <AllAgentsTier />
        </Suspense>
      </div>
    </div>
  );
}
