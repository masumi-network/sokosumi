import { Cog, MessageSquare } from "lucide-react";

import { type TaskAgentStep, type TaskCardData } from "@/app/tasks/types";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/utils/datetime";

import { AgentStatusIcon } from "./agent-status-icon";

interface TaskPrimaryAgentProps {
  agent?: TaskAgentStep;
  className?: string;
  nameClassName?: string;
}

export function TaskPrimaryAgent({
  agent,
  className,
  nameClassName,
}: TaskPrimaryAgentProps) {
  if (!agent) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("truncate", nameClassName)}>{agent.name}</span>
      <AgentStatusIcon status={agent.status} />
    </div>
  );
}

interface BudgetSummaryProps {
  budgetLabel: string;
  budget?: number | null;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

export function BudgetSummary({
  budgetLabel,
  budget,
  className,
  labelClassName,
  valueClassName,
}: BudgetSummaryProps) {
  if (budget === undefined || budget === null) return null;

  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center text-sm",
        className,
      )}
    >
      <span className={cn("text-foreground font-medium", labelClassName)}>
        {budgetLabel}:
      </span>
      <span className={cn("ml-1", valueClassName)}>
        {typeof budget === "number" ? `$${budget}` : "—"}
      </span>
    </div>
  );
}

interface TaskMetaDetailsProps {
  orchestrator: TaskCardData["orchestrator"];
  commentsCount: TaskCardData["commentsCount"];
  date: TaskCardData["date"];
  variant?: "card" | "list";
}

export function TaskMetaDetails({
  orchestrator,
  commentsCount,
  date,
  variant = "card",
}: TaskMetaDetailsProps) {
  if (variant === "list") {
    return (
      <>
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate">
          <Cog className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{orchestrator}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="size-4" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5">
          <span className="whitespace-nowrap">{formatShortDate(date)}</span>
        </div>
      </>
    );
  }

  return (
    <div className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        <Cog className="size-4" aria-hidden />
        <span>{orchestrator}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="size-4" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>{formatShortDate(date)}</span>
        </div>
      </div>
    </div>
  );
}
