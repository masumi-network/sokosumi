import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentCard } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { getAvailableAgentsWithCreditsPrice } from "@/lib/services";

export default async function FeaturedAgents() {
  const t = await getTranslations("Landing.Page.FeaturedAgents");
  const agentsWithPrice = (await getAvailableAgentsWithCreditsPrice()).slice(
    0,
    4,
  );

  return (
    <CreateJobModalContextProvider agentsWithPrice={agentsWithPrice}>
      <div className="flex w-full flex-col gap-8 md:gap-12">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-light md:text-4xl">{t("title")}</h2>
          <Button variant="secondary" asChild>
            <Link href="/agents">{t("button")}</Link>
          </Button>
        </div>

        <ScrollArea className="w-full">
          <div className="flex flex-row justify-between gap-2 py-2">
            {agentsWithPrice.map(({ agent, creditsPrice }) => (
              <div key={agent.id} className="flex-shrink-0">
                <AgentCard agent={agent} agentCreditsPrice={creditsPrice} />
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
