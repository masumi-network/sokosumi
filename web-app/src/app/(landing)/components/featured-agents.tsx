import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentCard } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { CreditsPrice, getOnlineAgents } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";
import { cn } from "@/lib/utils";

export default async function FeaturedAgents() {
  const t = await getTranslations("Landing.Page.FeaturedAgents");
  const agents = await getOnlineAgents();
  const firstFourAgents = agents.slice(0, 4);

  const agentPriceResults = await Promise.allSettled(
    firstFourAgents.map(async (agent) => {
      const price = await getAgentCreditsPrice(agent);
      return { agent, price };
    }),
  );

  const agentsWithPrice = agentPriceResults
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        agent: (typeof firstFourAgents)[number];
        price: CreditsPrice;
      }> => result.status === "fulfilled",
    )
    .map((result) => result.value);

  return (
    <div className="flex w-full flex-col gap-16">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-light">{t("title")}</h2>
        <Link href="/agents">
          <Button variant="outline">{t("button")}</Button>
        </Link>
      </div>

      <div className="flex flex-col justify-between gap-2.5 sm:flex-row">
        {agentsWithPrice.map(({ agent, price }, index) => (
          <div
            key={agent.id}
            className={cn(
              "flex-shrink-0",
              index === 2 && "hidden lg:block",
              index === 3 && "hidden xl:block",
            )}
          >
            <AgentCard agent={agent} agentCreditsPrice={price} />
          </div>
        ))}
      </div>
    </div>
  );
}
