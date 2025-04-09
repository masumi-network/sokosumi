import { getDescription } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/types/agent.types";

interface JobDetailSectionProps {
  agent: AgentWithRelations;
}

export default function JobDetailSection({ agent }: JobDetailSectionProps) {
  const description = getDescription(agent);

  return <>{description && <div>{description}</div>}</>;
}
