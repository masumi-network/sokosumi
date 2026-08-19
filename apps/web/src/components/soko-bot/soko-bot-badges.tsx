import { useTranslations } from "next-intl";

import type {
  SokoBotAutonomyLevel,
  SokoBotDelegation,
  SokoBotPendingDecision,
  SokoBotScheduleRun,
  SokoBotStatus,
  SokoBotToolCall,
  SokoBotTurnRoute,
  SokoBotTurnStatus,
} from "@/lib/clients/generated/core";

import { StatusBadge, type StatusTone } from "./status-badge";

const BOT_STATUS_TONE: Record<SokoBotStatus, StatusTone> = {
  IDLE: "neutral",
  RUNNING: "info",
  PAUSED: "warning",
  ERROR: "danger",
};

const TURN_STATUS_TONE: Record<SokoBotTurnStatus, StatusTone> = {
  QUEUED: "neutral",
  STARTING: "info",
  RUNNING: "info",
  CANCEL_REQUESTED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  FAILED: "danger",
};

const LIVE_TURN_STATUSES = new Set<SokoBotTurnStatus>([
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
]);

const ROUTE_TONE: Record<NonNullable<SokoBotTurnRoute>, StatusTone> = {
  DIRECT_RESPONSE: "neutral",
  CLARIFY: "warning",
  DELEGATE_TASK: "accent",
  HIRE_AGENT: "accent",
  MANAGE_WORK: "info",
  MIXED: "warning",
};

const DECISION_TONE: Record<SokoBotPendingDecision["status"], StatusTone> = {
  PENDING: "warning",
  PROCESSING: "info",
  ACCEPTED: "success",
  REJECTED: "neutral",
  EXPIRED: "neutral",
};

const RUN_TONE: Record<SokoBotScheduleRun["status"], StatusTone> = {
  PENDING: "neutral",
  CLAIMED: "info",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  DEAD_LETTER: "danger",
};

const TOOL_TONE: Record<SokoBotToolCall["status"], StatusTone> = {
  PENDING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

const AUTONOMY_TONE: Record<SokoBotAutonomyLevel, StatusTone> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "accent",
};

export function SokoBotStatusBadge({ status }: { status: SokoBotStatus }) {
  const t = useTranslations("Components.SokoBot.BotStatus");
  return (
    <StatusBadge tone={BOT_STATUS_TONE[status]} live={status === "RUNNING"}>
      {t(status)}
    </StatusBadge>
  );
}

export function TurnStatusBadge({ status }: { status: SokoBotTurnStatus }) {
  const t = useTranslations("Components.SokoBot.TurnStatus");
  return (
    <StatusBadge
      tone={TURN_STATUS_TONE[status]}
      live={LIVE_TURN_STATUSES.has(status)}
    >
      {t(status)}
    </StatusBadge>
  );
}

export function TurnRouteBadge({ route }: { route: SokoBotTurnRoute }) {
  const t = useTranslations("Components.SokoBot.Route");
  if (!route) {
    return <StatusBadge tone="neutral">{t("UNCLASSIFIED")}</StatusBadge>;
  }
  return <StatusBadge tone={ROUTE_TONE[route]}>{t(route)}</StatusBadge>;
}

export function DecisionStatusBadge({
  status,
}: {
  status: SokoBotPendingDecision["status"];
}) {
  const t = useTranslations("Components.SokoBot.DecisionStatus");
  return (
    <StatusBadge tone={DECISION_TONE[status]} live={status === "PROCESSING"}>
      {t(status)}
    </StatusBadge>
  );
}

export function ScheduleRunStatusBadge({
  status,
}: {
  status: SokoBotScheduleRun["status"];
}) {
  const t = useTranslations("Components.SokoBot.RunStatus");
  return (
    <StatusBadge tone={RUN_TONE[status]} live={status === "RUNNING"}>
      {t(status)}
    </StatusBadge>
  );
}

export function ToolCallStatusBadge({
  status,
}: {
  status: SokoBotToolCall["status"];
}) {
  const t = useTranslations("Components.SokoBot.ToolStatus");
  return (
    <StatusBadge tone={TOOL_TONE[status]} live={status === "PENDING"}>
      {t(status)}
    </StatusBadge>
  );
}

export function AutonomyBadge({ level }: { level: SokoBotAutonomyLevel }) {
  const t = useTranslations("Components.SokoBot.Autonomy");
  return <StatusBadge tone={AUTONOMY_TONE[level]}>{t(level)}</StatusBadge>;
}

export function DelegationKindBadge({
  kind,
}: {
  kind: SokoBotDelegation["kind"];
}) {
  const t = useTranslations("Components.SokoBot.DelegationKind");
  return <StatusBadge tone="accent">{t(kind)}</StatusBadge>;
}
