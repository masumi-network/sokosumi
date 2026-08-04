import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
} from "@/app/tasks/components/create-task-modal";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { AgentsNotAvailable, AgentsSkeleton } from "@/components/agents";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import { Skeleton } from "@/components/ui/skeleton";
import { mapCoreCategoriesToCategories } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import { coreClient } from "@/lib/clients/core.client";
import { coworkerService } from "@/lib/services/coworker.service";
import { getAgentRatingStatsMap } from "@/lib/types/core-dto";

import FilteredAgents from "./components/filtered-agents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function logAgentsCatalogFetchFailure(scope: string, error: unknown): void {
  console.warn(`[agents] ${scope} fetch failed`, {
    message: error instanceof Error ? error.message : String(error),
  });
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
  const coworkers = await coworkerService
    .listCoworkers("tasks")
    .catch(() => []);
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
 */
async function AllAgentsTier() {
  const [coreAgents, categoriesResponse, t] = await Promise.all([
    getAllCoreAgents().catch((error) => {
      logAgentsCatalogFetchFailure("agent catalog", error);
      return [];
    }),
    coreClient.getCategories().catch((error) => {
      logAgentsCatalogFetchFailure("categories", error);
      return { data: [] };
    }),
    getTranslations("App.Agents"),
  ]);

  if (!coreAgents.length) {
    return <AgentsNotAvailable />;
  }

  const categories = mapCoreCategoriesToCategories(categoriesResponse.data);
  const ratingStatsMap = getAgentRatingStatsMap(coreAgents);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-foreground text-xl font-light md:text-2xl">
          {t("allAgentsTitle")}
        </h2>
        <p className="text-muted-foreground text-sm md:text-base">
          {t("allAgentsSubtitle")}
        </p>
      </div>
      <FilteredAgents
        agents={coreAgents}
        ratingStatsMap={ratingStatsMap}
        categories={categories}
      />
    </section>
  );
}

export default function GalleryPage() {
  return (
    <div className="w-full">
      <div className="space-y-16 px-2 pb-8 md:space-y-24">
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
