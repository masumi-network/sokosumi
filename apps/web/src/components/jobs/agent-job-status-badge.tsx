"use client";

import { AgentJobStatus } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import { getToneStyle, type StatusTone } from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";

interface AgentJobStatusBadgeProps {
  status: AgentJobStatus;
  className?: string;
  variant?: "dot" | "text";
}

export function AgentJobStatusBadge({
  status,
  className,
  variant = "dot",
}: AgentJobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.AgentStatusBadge");
  const label = t(statusToLabelKey(status));
  const dotClass = getAgentStatusDotColorClass(status);

  if (variant === "text") {
    return (
      <span
        className={cn("text-muted-foreground text-2xs font-medium", className)}
      >
        {label}
      </span>
    );
  }

  return (
    <div className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
        aria-hidden
      />
      <span className="text-muted-foreground text-2xs font-medium">
        {label}
      </span>
    </div>
  );
}

/**
 * Agent job dots use the same hue table as `StatusMarker`, so a retune of
 * green / yellow / Iris / the X moves this badge with the rest of the app.
 *
 * Both waiting states sit on `blocked`. The label is what separates them —
 * they must not pull `--risk-high`, which belongs to the EU risk ladder.
 */
function agentStatusTone(status: AgentJobStatus): StatusTone {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return { hue: "resolved", weight: "filled" };
    case AgentJobStatus.FAILED:
      return { hue: "fault", weight: "filled" };
    case AgentJobStatus.AWAITING_INPUT:
    case AgentJobStatus.AWAITING_PAYMENT:
      return { hue: "blocked", weight: "filled" };
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return { hue: "active", weight: "filled" };
    default:
      return { hue: "dormant", weight: "filled" };
  }
}

export function getAgentStatusDotColorClass(status: AgentJobStatus) {
  return getToneStyle(agentStatusTone(status)).dot;
}

function statusToLabelKey(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.INITIATED:
      return "initiated";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "awaitingPayment";
    case AgentJobStatus.AWAITING_INPUT:
      return "awaitingInput";
    case AgentJobStatus.RUNNING:
      return "running";
    case AgentJobStatus.COMPLETED:
      return "completed";
    case AgentJobStatus.FAILED:
      return "failed";
    default:
      return "unknown";
  }
}
