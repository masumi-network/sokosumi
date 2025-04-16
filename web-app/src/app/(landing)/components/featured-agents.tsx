import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentCard } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { getAgents } from "@/lib/db/services/agent.service";
import { getAgentCreditsPrice } from "@/lib/db/services/credit.service";

export default async function FeaturedAgents() {
  const t = await getTranslations("Landing.Page.FeaturedAgents");
  const agents = await getAgents();
  const firstFourAgents = agents.slice(0, 4);

  const agentPriceList = await Promise.all(
    firstFourAgents.map(async (agent) => {
      return await getAgentCreditsPrice(agent);
    }),
  );

  return (
    <div className="flex w-full flex-col gap-16">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-light">{t("title")}</h2>
        <Button className="bg-quarterny text-foreground hover:bg-quarterny/90 text-sm">
          <Link href="/agents">{t("button")}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {firstFourAgents.map((agent, index) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            agentCreditsPrice={agentPriceList[index]}
          />
        ))}
      </div>
    </div>
  );
}
