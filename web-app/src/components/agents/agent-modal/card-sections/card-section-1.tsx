import {
  AgentDetailSection1,
  AgentDetailSection1Skeleton,
} from "@/components/agents/details";
import { AgentListWithAgent, AgentWithRelations, CreditsPrice } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection1({
  agent,
  agentList,
  agentCreditsPrice,
}: {
  agent: AgentWithRelations;
  agentList: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
}) {
  return (
    <CardSection>
      <AgentDetailSection1
        agent={agent}
        agentList={agentList}
        agentCreditsPrice={agentCreditsPrice}
      />
    </CardSection>
  );
}

function CardSection1Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection1Skeleton />
    </CardSection>
  );
}

export { CardSection1, CardSection1Skeleton };
