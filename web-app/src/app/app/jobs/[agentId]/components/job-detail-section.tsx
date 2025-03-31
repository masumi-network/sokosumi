import { AgentWithRelations, getDescription } from "@/lib/db/extension/agent";

interface JobDetailSectionProps {
  agent: AgentWithRelations;
}

export default function JobDetailSection({ agent }: JobDetailSectionProps) {
  const description = getDescription(agent);

  return <>{description && <div>{description}</div>}</>;
}
