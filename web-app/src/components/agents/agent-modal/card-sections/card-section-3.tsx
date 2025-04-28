import { useTranslations } from "next-intl";

import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  getAgentDescription,
  getAgentTags,
} from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection3({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card3");
  const agentDescription = getAgentDescription(agent);

  return (
    <CardSection>
      <div>
        {agentDescription && (
          <>
            <p className="text-xs uppercase">{t("title1")}</p>
            <p className="mt-2 mb-10">{getAgentDescription(agent)}</p>
          </>
        )}
        <p className="mb-2 text-xs uppercase">{t("title2")}</p>
        <AgentBadgeCloud tags={getAgentTags(agent)} />
      </div>
    </CardSection>
  );
}

function CardSection3Skeleton() {
  return (
    <CardSection>
      <div>
        <Skeleton className="h-4 w-12" />
        <Skeleton className="mt-2 mb-10 h-32 w-full" />
        <Skeleton className="h-4 w-12" />
        <div className="mt-2 flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-4 w-8" />
          ))}
        </div>
      </div>
    </CardSection>
  );
}

export { CardSection3, CardSection3Skeleton };
