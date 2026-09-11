"use client";

import { useTranslations } from "next-intl";
import { AgentJobStatus } from "@/lib/clients/generated/core";

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
          "text-muted-foreground text-[0.625rem] font-medium tracking-wider uppercase",
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
      <span className="text-muted-foreground text-[0.625rem] font-medium tracking-wider uppercase">
        {label}
      </span>
    </div>
  );
}

export function getAgentStatusDotColorClass(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return "bg-semantic-success";
    case AgentJobStatus.FAILED:
      return "bg-semantic-destructive";
    case AgentJobStatus.AWAITING_INPUT:
      return "bg-semantic-warning";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "bg-risk-high";
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return "bg-status-running";
    default:
      return "bg-status-done";
  }
}

export function getAgentStatusBorderColorClass(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return "border-semantic-success-tertiary";
    case AgentJobStatus.FAILED:
      return "border-semantic-destructive-tertiary";
    case AgentJobStatus.AWAITING_INPUT:
      return "border-semantic-warning-tertiary";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "border-semantic-warning-tertiary";
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return "border-status-running-tertiary";
    default:
      return "border-status-done-tertiary";
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
