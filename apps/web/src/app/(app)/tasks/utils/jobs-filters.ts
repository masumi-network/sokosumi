import { AgentJobStatus } from "@sokosumi/database";

import {
  firstQueryString,
  getDefaultTasksScope,
  getTasksFiltersResetKey,
  normalizeOptionalString,
  sanitizeTasksScopeInput,
  type TasksFilterQueryParam,
  type TasksFilters,
  type TasksScope,
} from "@/app/tasks/utils/tasks-filters";

export interface JobsListFilters {
  scope: TasksScope;
  agentId: string | null;
  jobStatus: AgentJobStatus | null;
}

export interface JobsListFiltersSearchParams {
  scope?: TasksFilterQueryParam;
  agentId?: TasksFilterQueryParam;
  jobStatus?: TasksFilterQueryParam;
}

export const JOBS_LIST_FILTER_PARAM_KEYS = {
  scope: "scope",
  agentId: "agentId",
  jobStatus: "jobStatus",
} as const;

type SearchParamsLike = Pick<URLSearchParams, "toString">;
type AgentOptionLike = { id: string };

function isAgentJobStatusValue(value: string | null): value is AgentJobStatus {
  return (
    value !== null &&
    Object.values(AgentJobStatus).includes(value as AgentJobStatus)
  );
}

export function sanitizeAgentJobStatusInput(
  raw: unknown,
): AgentJobStatus | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }
  return isAgentJobStatusValue(normalized) ? normalized : null;
}

export function sanitizeJobAgentIdInput(
  raw: unknown,
  agentOptions: ReadonlyArray<AgentOptionLike>,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  return agentOptions.some((agent) => agent.id === normalized)
    ? normalized
    : null;
}

export function parseJobsListFilters(
  searchParams: JobsListFiltersSearchParams,
  activeOrganizationId: string | null,
  agentOptions: ReadonlyArray<AgentOptionLike>,
): JobsListFilters {
  return {
    scope: sanitizeTasksScopeInput(
      firstQueryString(searchParams.scope),
      activeOrganizationId,
    ),
    agentId: sanitizeJobAgentIdInput(
      normalizeOptionalString(searchParams.agentId),
      agentOptions,
    ),
    jobStatus: sanitizeAgentJobStatusInput(
      normalizeOptionalString(searchParams.jobStatus),
    ),
  };
}

export function getJobsListFiltersFromSearchParams(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  agentOptions: ReadonlyArray<AgentOptionLike>,
): JobsListFilters {
  return parseJobsListFilters(
    {
      scope: searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.scope) ?? undefined,
      agentId:
        searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.agentId) ?? undefined,
      jobStatus:
        searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.jobStatus) ?? undefined,
    },
    activeOrganizationId,
    agentOptions,
  );
}

export function buildJobsListFiltersSearchParams(
  currentSearchParams: URLSearchParams | SearchParamsLike,
  filters: JobsListFilters,
  activeOrganizationId: string | null,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(currentSearchParams.toString());
  const defaultScope = getDefaultTasksScope(activeOrganizationId);

  if (filters.scope === defaultScope) {
    nextSearchParams.delete(JOBS_LIST_FILTER_PARAM_KEYS.scope);
  } else {
    nextSearchParams.set(JOBS_LIST_FILTER_PARAM_KEYS.scope, filters.scope);
  }

  if (filters.agentId) {
    nextSearchParams.set(JOBS_LIST_FILTER_PARAM_KEYS.agentId, filters.agentId);
  } else {
    nextSearchParams.delete(JOBS_LIST_FILTER_PARAM_KEYS.agentId);
  }

  if (filters.jobStatus) {
    nextSearchParams.set(
      JOBS_LIST_FILTER_PARAM_KEYS.jobStatus,
      filters.jobStatus,
    );
  } else {
    nextSearchParams.delete(JOBS_LIST_FILTER_PARAM_KEYS.jobStatus);
  }

  return nextSearchParams;
}

export function getJobsListFiltersResetKey(
  filters: JobsListFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.scope}:${filters.agentId ?? "all"}:${filters.jobStatus ?? "all"}`;
}

export function getTasksViewServerResetKey(
  tasksFilters: TasksFilters,
  jobsListFilters: JobsListFilters,
  activeOrganizationId: string | null,
): string {
  return `${getTasksFiltersResetKey(tasksFilters, activeOrganizationId)}:${getJobsListFiltersResetKey(jobsListFilters, activeOrganizationId)}`;
}
