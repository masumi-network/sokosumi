import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentCard } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { getOnlineAgentsWithCreditsPrice } from "@/lib/services";
import { cn } from "@/lib/utils";

export default async function FeaturedAgents() {
  const t = await getTranslations("Landing.Page.FeaturedAgents");
  const agentsWithPrice = (await getOnlineAgentsWithCreditsPrice()).slice(0, 4);

  return (
    <div className="flex w-full flex-col gap-16">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-light">{t("title")}</h2>
        <Button variant="secondary" asChild>
          <Link href="/agents">{t("button")}</Link>
        </Button>
      </div>

      <div className="flex flex-col justify-between gap-2.5 sm:flex-row">
        {agentsWithPrice.map(({ agent, creditsPrice }, index) => (
          <div
            key={agent.id}
            className={cn(
              "flex-shrink-0",
              index === 2 && "hidden lg:block",
              index === 3 && "hidden xl:block",
            )}
          >
            <AgentCard agent={agent} agentCreditsPrice={creditsPrice} />
          </div>
        ))}
      </div>
    </div>
  );
}
