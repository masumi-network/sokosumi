import {
  firstQueryString,
  getDefaultTasksScope,
  normalizeOptionalString,
  type ProjectFilterOption,
  sanitizeProjectIdFilterInput,
  sanitizeTasksScopeInput,
  type TasksFilterQueryParam,
  type TasksScope,
} from "@/app/tasks/utils/tasks-filters";
import {
  AgentJobStatus,
  SokosumiJobStatus,
} from "@/lib/clients/generated/core";

export interface JobsListFilters {
  scope: TasksScope;
  agentId: string | null;
  jobStatus: AgentJobStatus | null;
  projectId: string | null;
}

export interface JobsListFiltersSearchParams {
  scope?: TasksFilterQueryParam;
  agentId?: TasksFilterQueryParam;
  jobStatus?: TasksFilterQueryParam;
  projectId?: TasksFilterQueryParam;
}

export const JOBS_LIST_FILTER_PARAM_KEYS = {
  scope: "scope",
  agentId: "agentId",
  jobStatus: "jobStatus",
  projectId: "projectId",
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

/** Upper bound for DB-backed agent IDs (cuid, uuid, etc.). */
const JOB_AGENT_ID_MAX_LENGTH = 128;

/**
 * Normalizes an agent id for server actions that replay an already-applied jobs
 * filter (e.g. pagination). Unlike {@link sanitizeJobAgentIdInput}, this does not
 * consult the live availability catalog — an agent can disappear from the picker
 * while the user is paging, and the list API must keep filtering by the same id.
 */
export function sanitizeJobAgentIdForPersistedFilter(
  raw: unknown,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  if (!normalized || normalized.length > JOB_AGENT_ID_MAX_LENGTH) {
    return null;
  }

  return normalized;
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
    projectId: sanitizeProjectIdFilterInput(
      normalizeOptionalString(searchParams.projectId),
    ),
  };
}

export function getJobsListFiltersFromSearchParams(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  agentOptions: ReadonlyArray<AgentOptionLike>,
  projectOptions?: ReadonlyArray<ProjectFilterOption>,
): JobsListFilters {
  const parsed = parseJobsListFilters(
    {
      scope: searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.scope) ?? undefined,
      agentId:
        searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.agentId) ?? undefined,
      jobStatus:
        searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.jobStatus) ?? undefined,
      projectId:
        searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.projectId) ?? undefined,
    },
    activeOrganizationId,
    agentOptions,
  );
  const projectId =
    projectOptions === undefined ||
    (parsed.projectId &&
      projectOptions.some((project) => project.id === parsed.projectId))
      ? parsed.projectId
      : null;

  return {
    ...parsed,
    projectId,
  };
}

/**
 * Like {@link getJobsListFiltersFromSearchParams}, but while the jobs-tab agent
 * catalog is still empty (lazy-loaded), keep the URL `agentId` via persisted
 * sanitize so the first fetch does not drop deep-link / bookmarked filters.
 */
export function getJobsListFiltersForLazyAgentCatalog(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  agentOptions: ReadonlyArray<AgentOptionLike>,
  projectOptions?: ReadonlyArray<ProjectFilterOption>,
): JobsListFilters {
  const parsed = getJobsListFiltersFromSearchParams(
    searchParams,
    activeOrganizationId,
    agentOptions,
    projectOptions,
  );
  if (agentOptions.length > 0) {
    return parsed;
  }
  return {
    ...parsed,
    agentId: sanitizeJobAgentIdForPersistedFilter(
      searchParams.get(JOBS_LIST_FILTER_PARAM_KEYS.agentId),
    ),
  };
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

  if (filters.projectId) {
    nextSearchParams.set(
      JOBS_LIST_FILTER_PARAM_KEYS.projectId,
      filters.projectId,
    );
  } else {
    nextSearchParams.delete(JOBS_LIST_FILTER_PARAM_KEYS.projectId);
  }

  return nextSearchParams;
}

export function getJobsListFiltersResetKey(
  filters: JobsListFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.scope}:${filters.agentId ?? "all"}:${filters.jobStatus ?? "all"}:${filters.projectId ?? "all"}`;
}

/** Minimal job fields needed when merging a refetched first page with prior pages. */
export type JobsListMergeableJob = {
  id: string;
  agentId: string;
  status: SokosumiJobStatus;
};

/**
 * When {@link mergeTopPageJobsWithListFilters} keeps jobs from before the refetch that are
 * absent from the refreshed first page, only rows that can still match the active URL
 * filters are retained. This avoids resurrecting rows the filtered API intentionally omitted
 * (e.g. a job that left RUNNING while the list is filtered to RUNNING).
 */
export function tasksViewJobStillEligibleForJobsListFilters(
  job: JobsListMergeableJob,
  filters: JobsListFilters,
): boolean {
  if (filters.agentId !== null && job.agentId !== filters.agentId) {
    return false;
  }
  if (filters.jobStatus === null) {
    return true;
  }
  return !isSokosumiStatusClearlyOutsideAgentJobFilter(
    job.status,
    filters.jobStatus,
  );
}

function isSokosumiStatusClearlyOutsideAgentJobFilter(
  status: SokosumiJobStatus,
  filter: AgentJobStatus,
): boolean {
  switch (filter) {
    case AgentJobStatus.COMPLETED:
      return status !== SokosumiJobStatus.COMPLETED;
    case AgentJobStatus.FAILED:
      return (
        status !== SokosumiJobStatus.FAILED &&
        status !== SokosumiJobStatus.PAYMENT_FAILED
      );
    case AgentJobStatus.AWAITING_PAYMENT:
      return (
        status !== SokosumiJobStatus.PAYMENT_PENDING &&
        status !== SokosumiJobStatus.STARTED
      );
    case AgentJobStatus.RUNNING:
      return (
        status === SokosumiJobStatus.COMPLETED ||
        status === SokosumiJobStatus.FAILED ||
        status === SokosumiJobStatus.PAYMENT_FAILED ||
        status === SokosumiJobStatus.PAYMENT_PENDING ||
        status === SokosumiJobStatus.STARTED ||
        status === SokosumiJobStatus.INPUT_REQUIRED ||
        status === SokosumiJobStatus.REFUND_RESOLVED ||
        status === SokosumiJobStatus.DISPUTE_RESOLVED
      );
    case AgentJobStatus.AWAITING_INPUT:
      return status !== SokosumiJobStatus.INPUT_REQUIRED;
    case AgentJobStatus.INITIATED:
      return (
        status === SokosumiJobStatus.COMPLETED ||
        status === SokosumiJobStatus.FAILED ||
        status === SokosumiJobStatus.PAYMENT_FAILED ||
        status === SokosumiJobStatus.REFUND_RESOLVED ||
        status === SokosumiJobStatus.DISPUTE_RESOLVED
      );
  }
}

/**
 * Merges the first page of jobs returned from the server with any extra pages already loaded
 * client-side. When agent or job-status filters are active, jobs from the previous list that
 * no longer plausibly match those filters are dropped so they cannot reappear after a refetch.
 */
export function mergeTopPageJobsWithListFilters<T extends JobsListMergeableJob>(
  prevJobs: T[],
  refreshedJobs: T[],
  filters: JobsListFilters,
): T[] {
  const hasNarrowingFilter =
    filters.jobStatus !== null || filters.agentId !== null;
  if (!hasNarrowingFilter) {
    return mergeTopPageJobsPlain(prevJobs, refreshedJobs);
  }

  const refreshedJobIds = new Set(refreshedJobs.map((job) => job.id));
  const remainingJobs = prevJobs.filter(
    (job) =>
      !refreshedJobIds.has(job.id) &&
      tasksViewJobStillEligibleForJobsListFilters(job, filters),
  );
  return [...refreshedJobs, ...remainingJobs];
}

function mergeTopPageJobsPlain<T extends { id: string }>(
  prevJobs: T[],
  refreshedJobs: T[],
): T[] {
  const refreshedJobIds = new Set(refreshedJobs.map((job) => job.id));
  const remainingJobs = prevJobs.filter((job) => !refreshedJobIds.has(job.id));
  return [...refreshedJobs, ...remainingJobs];
}
