import { CheckCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface AgentVerifiedBadgeProps {
  className?: string;
}

function AgentVerifiedBadge({ className }: AgentVerifiedBadgeProps) {
  return (
    <div
      className={cn(
        "bg-agent-verified-background flex items-center gap-1 rounded-full px-2 py-0.5",
        className,
      )}
    >
      <CheckCheck className="text-agent-verified-foreground h-4 w-4" />
      <span className="text-agent-verified-foreground text-xs uppercase">
        {"Verified"}
      </span>
    </div>
  );
}

export { AgentVerifiedBadge };
