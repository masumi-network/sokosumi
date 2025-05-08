import {
  AgentDetailSection4,
  AgentDetailSection4Skeleton,
} from "@/components/agents/details";
import { AgentWithRelations, getAgentExampleOutput } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection4({ agent }: { agent: AgentWithRelations }) {
  const exampleOutputs = getAgentExampleOutput(agent);

  if (exampleOutputs.length == 0) {
    return null;
  }

  return (
    <CardSection>
      <AgentDetailSection4 exampleOutputs={exampleOutputs} />
    </CardSection>
  );
}

function CardSection4Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection4Skeleton />
    </CardSection>
  );
}

export { CardSection4, CardSection4Skeleton };
