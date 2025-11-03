import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface AgentVerifiedBadgeProps {
  className?: string;
}

function AgentVerifiedBadge({ className }: AgentVerifiedBadgeProps) {
  return (
    <div
      className={cn(
        "bg-agent-verified-background flex items-center gap-1 rounded-md p-2",
        className,
      )}
    >
      <ShieldCheck
        strokeWidth={1}
        className="text-agent-verified-foreground size-6"
      />
    </div>
  );
}

export { AgentVerifiedBadge };
