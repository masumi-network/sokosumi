import { getDescription } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/services/agent.service";

interface JobDetailSectionProps {
  agent: AgentWithRelations;
}

export default function JobDetailSection({ agent }: JobDetailSectionProps) {
  const description = getDescription(agent);

  return <>{description && <div>{description}</div>}</>;
}
