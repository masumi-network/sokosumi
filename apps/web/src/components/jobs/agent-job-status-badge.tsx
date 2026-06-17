"use client";

import { AgentJobStatus } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

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
        className={cn(
          "text-muted-foreground text-[10px] font-medium tracking-wider uppercase",
          className,
        )}
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
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
    </div>
  );
}

export function getAgentStatusDotColorClass(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return "bg-green-500";
    case AgentJobStatus.FAILED:
      return "bg-red-500";
    case AgentJobStatus.AWAITING_INPUT:
      return "bg-yellow-500";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "bg-orange-500";
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return "bg-sky-500";
    default:
      return "bg-gray-500";
  }
}

export function getAgentStatusBorderColorClass(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return "border-green-500/40";
    case AgentJobStatus.FAILED:
      return "border-red-500/40";
    case AgentJobStatus.AWAITING_INPUT:
      return "border-yellow-500/40";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "border-orange-500/40";
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return "border-sky-500/40";
    default:
      return "border-gray-500/40";
  }
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
