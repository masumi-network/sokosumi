import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { cn } from "@/lib/utils";

import AgentCard, { AgentCardSkeleton } from "./agent-card";

interface AgentsSkeletonProps {
  className?: string;
}

export function AgentsSkeleton({ className }: AgentsSkeletonProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap justify-center gap-6 px-4 lg:px-8 xl:px-16",
        className,
      )}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <AgentCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface AgentsProps {
  agents: AgentDTO[];
  className?: string;
  agentCardClassName?: string;
}

export default function Agents({
  agents,
  className = "",
  agentCardClassName = "",
}: AgentsProps) {
  return (
    <div
      className={cn("flex w-full flex-wrap justify-center gap-6", className)}
    >
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          className={agentCardClassName}
        />
      ))}
    </div>
  );
}
