import {
  AgentDetailSection2,
  AgentDetailSection2Skeleton,
} from "@/components/agents/details";
import { AgentWithRelations, JobWithRelations } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection2({
  agent,
  jobs,
}: {
  agent: AgentWithRelations;
  jobs: JobWithRelations[];
}) {
  return (
    <CardSection>
      <AgentDetailSection2 agent={agent} jobs={jobs} />
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
