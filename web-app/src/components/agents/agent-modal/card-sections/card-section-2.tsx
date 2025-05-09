import {
  AgentDetailSection2,
  AgentDetailSection2Skeleton,
} from "@/components/agents/details";
import { JobWithRelations } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection2({ jobs }: { jobs: JobWithRelations[] }) {
  return (
    <CardSection>
      <AgentDetailSection2 jobs={jobs} />
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
