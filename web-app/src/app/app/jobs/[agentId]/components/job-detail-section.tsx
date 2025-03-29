import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface JobDetailSectionProps {
  agent: AgentDTO;
}

export default function JobDetailSection({ agent }: JobDetailSectionProps) {
  const { description } = agent;

  return <div>{description}</div>;
}
