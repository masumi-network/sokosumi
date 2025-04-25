import { AgentVerifiedBadge } from "./agent-verified-badge";

interface AgentTitleWithBadgeProps {
  title: string;
}

export function AgentTitleWithBadge({ title }: AgentTitleWithBadgeProps) {
  return (
    <div className="relative">
      <div className="flex items-start gap-1">
        <h3 className="text-5xl font-light">{title}</h3>
        <AgentVerifiedBadge className="mt-1" />
      </div>
    </div>
  );
}
