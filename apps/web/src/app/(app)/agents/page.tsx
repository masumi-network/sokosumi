import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
} from "@/app/tasks/components/create-task-modal";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { AgentsNotAvailable } from "@/components/agents";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import { mapCoreCategoriesToCategories } from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
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

export default async function GalleryPage() {
  const [coreAgents, categoriesResponse, coworkers, session] =
    await Promise.all([
      getAllCoreAgents().catch((error) => {
        logAgentsCatalogFetchFailure("agent catalog", error);
        return [];
      }),
      coreClient.getCategories().catch((error) => {
        logAgentsCatalogFetchFailure("categories", error);
        return { data: [] };
      }),
      coworkerService.listCoworkers("tasks").catch(() => []),
      getSession(),
    ]);

  if (!coreAgents.length) {
    return <AgentsNotAvailable />;
  }

  const categories = mapCoreCategoriesToCategories(categoriesResponse.data);
  const ratingStatsMap = getAgentRatingStatsMap(coreAgents);
  const t = await getTranslations("App.Agents");

  // Wiring for the create-task modal so a task can be started in place from the
  // coworker gallery (no navigation to /tasks, picker step pre-skipped). All
  // data still flows from the Core API — coworkers via coworkerService,
  // agent names from Core agents, design.md via its service.
  const initialDesignMdAttachment = session?.user.id
    ? await designMdService.resolveEffectiveDesignMd()
    : null;
  const coworkerOptions = getCoworkerOptions(coworkers);
  const agentNameById = buildAgentNameById(coreAgents);

  return (
    <div className="w-full">
      <div className="space-y-16 px-2 pb-8 md:space-y-24">
        {/* Tier 1 — curated: your coworkers + their ready-to-run offers */}
        <CreateTaskModalProvider>
          <CoworkerGallerySection
            coworkers={coworkers}
            agentCount={coreAgents.length}
          />
          <CreateTaskModal
            coworkerOptions={coworkerOptions}
            agentNameById={agentNameById}
            initialDesignMdAttachment={initialDesignMdAttachment}
          />
        </CreateTaskModalProvider>

        {/* Tier 2 — browse the full catalog, grouped by what agents do */}
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
      </div>
    </div>
  );
}
