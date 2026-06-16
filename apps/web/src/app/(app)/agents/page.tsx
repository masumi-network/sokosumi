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
import {
  mapCoreAgentRatingStatsMap,
  mapCoreAgentsToAgentWithCreditsPrice,
  mapCoreCategoriesToCategories,
} from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";

import FilteredAgents from "./components/filtered-agents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const [coreAgents, categoriesResponse, coworkers, session] =
    await Promise.all([
      getAllCoreAgents(),
      coreClient.getCategories(),
      coworkerService.listCoworkers(),
      getSession(),
    ]);
  const agentsWithPrice = mapCoreAgentsToAgentWithCreditsPrice(coreAgents);

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const categories = mapCoreCategoriesToCategories(categoriesResponse.data);
  const ratingStatsMap = mapCoreAgentRatingStatsMap(coreAgents);
  const t = await getTranslations("App.Agents");

  // Wiring for the create-task modal so a task can be started in place from the
  // coworker gallery (no navigation to /tasks, picker step pre-skipped).
  const initialDesignMdAttachment = session?.user.id
    ? await designMdService.resolveEffectiveDesignMd()
    : null;
  const coworkerOptions = getCoworkerOptions(coworkers);
  const agentNameById = buildAgentNameById(agentsWithPrice);

  return (
    <div className="w-full">
      <div className="space-y-16 px-2 md:space-y-24">
        {/* Tier 1 — curated: your coworkers + their ready-to-run offers */}
        <CreateTaskModalProvider>
          <CoworkerGallerySection
            coworkers={coworkers}
            agentCount={agentsWithPrice.length}
          />
          <CreateTaskModal
            coworkerOptions={coworkerOptions}
            agentNameById={agentNameById}
            initialDesignMdAttachment={initialDesignMdAttachment}
          />
        </CreateTaskModalProvider>

        {/* Tier 2 — browse the full catalog, grouped by what agents do */}
        <section className="space-y-8">
          <h2 className="text-foreground text-xl font-light md:text-2xl">
            {t("allAgentsTitle")}
          </h2>
          <FilteredAgents
            agents={agentsWithPrice}
            ratingStatsMap={ratingStatsMap}
            categories={categories}
          />
        </section>
      </div>
    </div>
  );
}
