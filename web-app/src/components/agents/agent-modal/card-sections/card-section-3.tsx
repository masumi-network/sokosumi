import { useTranslations } from "next-intl";

import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
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

export { CardSection3 };
