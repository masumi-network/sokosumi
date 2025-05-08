import {
  AgentDetailSection2,
  AgentDetailSection2Skeleton,
} from "@/components/agents/details";
import { AgentWithRelations } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection2({ agent }: { agent: AgentWithRelations }) {
  return (
    <CardSection>
      <AgentDetailSection2 agent={agent} />
    </CardSection>
  );
}

function CardSection2Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection2Skeleton />
    </CardSection>
  );
}

export { CardSection2, CardSection2Skeleton };
