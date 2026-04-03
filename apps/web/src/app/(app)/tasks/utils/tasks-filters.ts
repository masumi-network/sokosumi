import { AgentJobStatus, TaskStatus } from "@sokosumi/database";

export const TASKS_TAB_VALUES = ["tasks", "jobs"] as const;

export type TasksTabValue = (typeof TASKS_TAB_VALUES)[number];

export interface TasksRouteFilters {
  tab: TasksTabValue;
  memberId: string | null;
  coworkerId: string | null;
  agentId: string | null;
  taskStatus: TaskStatus | null;
  jobStatus: AgentJobStatus | null;
}

type SearchParamValue = string | string[] | undefined;

function readFirstParam(value: SearchParamValue): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return typeof value === "string" ? value : null;
}

function normalizeOptionalString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function isTasksTabValue(value: string | null): value is TasksTabValue {
  return value === "tasks" || value === "jobs";
}

export function isTaskStatusValue(value: string | null): value is TaskStatus {
  return (
    value !== null && Object.values(TaskStatus).includes(value as TaskStatus)
  );
}

export function isJobStatusValue(
  value: string | null,
): value is AgentJobStatus {
  return (
    value !== null &&
    Object.values(AgentJobStatus).includes(value as AgentJobStatus)
  );
}

export function parseTasksRouteFilters(
  searchParams: Record<string, SearchParamValue>,
): TasksRouteFilters {
  const rawTab = normalizeOptionalString(readFirstParam(searchParams.tab));
  const rawMemberId = normalizeOptionalString(
    readFirstParam(searchParams.memberId),
  );
  const rawCoworkerId = normalizeOptionalString(
    readFirstParam(searchParams.coworkerId),
  );
  const rawAgentId = normalizeOptionalString(
    readFirstParam(searchParams.agentId),
  );
  const rawTaskStatus = normalizeOptionalString(
    readFirstParam(searchParams.taskStatus),
  );
  const rawJobStatus = normalizeOptionalString(
    readFirstParam(searchParams.jobStatus),
  );

  return {
    tab: isTasksTabValue(rawTab) ? rawTab : "tasks",
    memberId: rawMemberId,
    coworkerId: rawCoworkerId,
    agentId: rawAgentId,
    taskStatus: isTaskStatusValue(rawTaskStatus) ? rawTaskStatus : null,
    jobStatus: isJobStatusValue(rawJobStatus) ? rawJobStatus : null,
  };
}
