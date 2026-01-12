import { Check, Clock3, X } from "lucide-react";

import { type TaskAgentStep } from "@/app/tasks/types";

interface AgentStatusIconProps {
  status: TaskAgentStep["status"];
}

const STATUS_ICON_MAP: Record<
  AgentStatusIconProps["status"],
  { Icon: typeof Check; className: string }
> = {
  done: { Icon: Check, className: "text-emerald-500" },
  blocked: { Icon: X, className: "text-destructive" },
  pending: { Icon: Clock3, className: "text-amber-500" },
};

export function AgentStatusIcon({ status }: AgentStatusIconProps) {
  const { Icon, className } = STATUS_ICON_MAP[status];

  return <Icon className={`size-4 ${className}`} aria-hidden />;
}
