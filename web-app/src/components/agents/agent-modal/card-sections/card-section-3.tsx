import {
  AgentDetailSection3,
  AgentDetailSection3Skeleton,
} from "@/components/agents/details";
import { AgentWithRelations } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection3({ agent }: { agent: AgentWithRelations }) {
  return (
    <CardSection>
      <AgentDetailSection3 agent={agent} />
    </CardSection>
  );
}

function CardSection3Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection3Skeleton />
    </CardSection>
  );
}

export { CardSection3, CardSection3Skeleton };
