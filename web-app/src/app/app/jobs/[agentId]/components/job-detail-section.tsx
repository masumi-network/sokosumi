import { AgentWithRelations, getDescription } from "@/lib/db/extension/agent";

interface JobDetailSectionProps {
  agent: AgentWithRelations;
}

export default function JobDetailSection({ agent }: JobDetailSectionProps) {
  return <div>{getDescription(agent) ?? "No description available"}</div>;
}
