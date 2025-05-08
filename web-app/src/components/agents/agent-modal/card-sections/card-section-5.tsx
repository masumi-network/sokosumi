import {
  AgentDetailSection5,
  AgentDetailSection5Skeleton,
} from "@/components/agents/details";
import { AgentWithRelations, getAgentLegal } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection5({ agent }: { agent: AgentWithRelations }) {
  const legal = getAgentLegal(agent);

  if (!legal) {
    return null;
  }

  return (
    <CardSection>
      <AgentDetailSection5 legal={legal} />
    </CardSection>
  );
}

function CardSection5Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection5Skeleton />
    </CardSection>
  );
}

export { CardSection5, CardSection5Skeleton };
