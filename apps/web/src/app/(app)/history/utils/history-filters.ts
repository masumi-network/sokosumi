import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

export const HISTORY_SEARCH_MAX_LENGTH = 200;
export const HISTORY_SCOPE_VALUES = ["owned", "workspace"] as const;
export const HISTORY_TYPE_VALUES = ["task", "job"] as const;
export const HISTORY_DEFAULT_API_TYPES = HISTORY_TYPE_VALUES;
/** Non-task statuses shared across history kinds. `active` was conversation-only and was removed with SOK-671. */
export const HISTORY_NON_TASK_STATUS_VALUES = ["archived"] as const;
export const HISTORY_JOB_ONLY_STATUS_VALUES = [
  SokosumiJobStatus.STARTED,
  SokosumiJobStatus.RESULT_PENDING,
  SokosumiJobStatus.PAYMENT_PENDING,
  SokosumiJobStatus.PAYMENT_FAILED,
  SokosumiJobStatus.REFUND_PENDING,
  SokosumiJobStatus.REFUND_RESOLVED,
  SokosumiJobStatus.DISPUTE_PENDING,
  SokosumiJobStatus.DISPUTE_RESOLVED,
] as const;
export const HISTORY_STATUS_VALUES = [
  ...HISTORY_NON_TASK_STATUS_VALUES,
  ...Object.values(TaskStatus),
  ...HISTORY_JOB_ONLY_STATUS_VALUES,
] as const;
export const HISTORY_STATUS_OPTIONS = [
  ...HISTORY_NON_TASK_STATUS_VALUES,
  ...Object.values(TaskStatus),
  ...HISTORY_JOB_ONLY_STATUS_VALUES,
] as const;

/** Task statuses that map to computed job statuses in the history API. */
export const HISTORY_TASK_STATUS_VALUES_FOR_JOB_FILTER = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.RUNNING,
] as const;

const HISTORY_TASK_STATUS_VALUES = [
  "archived",
  ...Object.values(TaskStatus),
] as const satisfies readonly HistoryStatus[];

const HISTORY_JOB_STATUS_VALUES = [
  ...HISTORY_TASK_STATUS_VALUES_FOR_JOB_FILTER,
  ...HISTORY_JOB_ONLY_STATUS_VALUES,
] as const satisfies readonly HistoryStatus[];

export type HistoryScope = (typeof HISTORY_SCOPE_VALUES)[number];
export type HistoryType = (typeof HISTORY_TYPE_VALUES)[number];
export type HistoryStatus = (typeof HISTORY_STATUS_VALUES)[number];

export interface HistoryFilters {
  q: string | null;
  scope: HistoryScope;
  type: HistoryType | null;
  status: HistoryStatus | null;
  projectId: string | null;
}

export interface ProjectFilterOption {
  id: string;
  name: string;
}

/** App Router `searchParams` values can be `string | string[]` when a key is repeated. */
export type HistoryFilterQueryParam = string | string[] | undefined;

export interface HistoryFiltersSearchParams {
  q?: HistoryFilterQueryParam;
  scope?: HistoryFilterQueryParam;
  type?: HistoryFilterQueryParam;
  status?: HistoryFilterQueryParam;
  projectId?: HistoryFilterQueryParam;
}

export const HISTORY_FILTER_PARAM_KEYS = {
  q: "q",
  scope: "scope",
  type: "type",
  status: "status",
  projectId: "projectId",
} as const;

type SearchParamsLike = Pick<URLSearchParams, "toString">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `URLSearchParams#get`: first value wins when the key is repeated. */
export function firstHistoryQueryString(
  value: HistoryFilterQueryParam,
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string");
  }
  return value;
}

function normalizeOptionalString(
  value: HistoryFilterQueryParam,
): string | null {
  const raw = firstHistoryQueryString(value);
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

function isHistoryTypeValue(value: string | null): value is HistoryType {
  return value !== null && HISTORY_TYPE_VALUES.includes(value as HistoryType);
}

function isHistoryStatusValue(value: string | null): value is HistoryStatus {
  return (
    value !== null && HISTORY_STATUS_VALUES.includes(value as HistoryStatus)
  );
}

export function getHistoryStatusOptionsForType(
  type: HistoryType | null,
): readonly HistoryStatus[] {
  switch (type) {
    case "task":
      return HISTORY_TASK_STATUS_VALUES;
    case "job":
      return HISTORY_JOB_STATUS_VALUES;
    default:
      return HISTORY_STATUS_OPTIONS;
  }
}

export function resolveHistoryApiTypes(
  type: HistoryType | null,
): HistoryType[] {
  if (type) {
    return [type];
  }
  return [...HISTORY_DEFAULT_API_TYPES];
}

export function isHistoryStatusAllowedForType(
  status: HistoryStatus,
  type: HistoryType | null,
): boolean {
  return getHistoryStatusOptionsForType(type).includes(status);
}

export function sanitizeHistoryStatusForType(
  status: HistoryStatus | null,
  type: HistoryType | null,
): HistoryStatus | null {
  if (!status) return null;
  return isHistoryStatusAllowedForType(status, type) ? status : null;
}

export function applyHistoryProjectAllowlist(
  filters: HistoryFilters,
  projectOptions?: ReadonlyArray<ProjectFilterOption>,
): HistoryFilters {
  if (projectOptions === undefined) {
    return filters;
  }

  const projectId =
    filters.projectId &&
    projectOptions.some((project) => project.id === filters.projectId)
      ? filters.projectId
      : null;

  return {
    ...filters,
    projectId,
  };
}

function finalizeHistoryFilters(filters: HistoryFilters): HistoryFilters {
  return {
    ...filters,
    status: sanitizeHistoryStatusForType(filters.status, filters.type),
  };
}

export function getDefaultHistoryScope(
  activeOrganizationId: string | null,
): HistoryScope {
  return "owned";
}

export function sanitizeHistorySearchInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.trim().slice(0, HISTORY_SEARCH_MAX_LENGTH);
  return normalized ? normalized : null;
}

export function sanitizeHistoryScopeInput(
  raw: unknown,
  activeOrganizationId: string | null,
): HistoryScope {
  const defaultScope = getDefaultHistoryScope(activeOrganizationId);
  if (typeof raw !== "string") return defaultScope;

  const requestedScope = raw.trim();
  if (
    !requestedScope ||
    !HISTORY_SCOPE_VALUES.includes(requestedScope as HistoryScope)
  ) {
    return defaultScope;
  }
  if (requestedScope === "workspace" && !activeOrganizationId) {
    return defaultScope;
  }

  return requestedScope as HistoryScope;
}

export function sanitizeHistoryTypeInput(raw: unknown): HistoryType | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.trim();
  return isHistoryTypeValue(normalized) ? normalized : null;
}

export function sanitizeHistoryStatusInput(raw: unknown): HistoryStatus | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.trim();
  return isHistoryStatusValue(normalized) ? normalized : null;
}

export function sanitizeHistoryProjectIdInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function parseHistoryFilters(
  searchParams: HistoryFiltersSearchParams,
  activeOrganizationId: string | null,
): HistoryFilters {
  const type = sanitizeHistoryTypeInput(
    normalizeOptionalString(searchParams.type),
  );

  return finalizeHistoryFilters({
    q: sanitizeHistorySearchInput(normalizeOptionalString(searchParams.q)),
    scope: sanitizeHistoryScopeInput(
      firstHistoryQueryString(searchParams.scope),
      activeOrganizationId,
    ),
    type,
    status: sanitizeHistoryStatusInput(
      normalizeOptionalString(searchParams.status),
    ),
    projectId: sanitizeHistoryProjectIdInput(
      normalizeOptionalString(searchParams.projectId),
    ),
  });
}

export function getHistoryFiltersFromSearchParams(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  projectOptions?: ReadonlyArray<ProjectFilterOption>,
): HistoryFilters {
  const parsed = parseHistoryFilters(
    {
      q: searchParams.get(HISTORY_FILTER_PARAM_KEYS.q) ?? undefined,
      scope: searchParams.get(HISTORY_FILTER_PARAM_KEYS.scope) ?? undefined,
      type: searchParams.get(HISTORY_FILTER_PARAM_KEYS.type) ?? undefined,
      status: searchParams.get(HISTORY_FILTER_PARAM_KEYS.status) ?? undefined,
      projectId:
        searchParams.get(HISTORY_FILTER_PARAM_KEYS.projectId) ?? undefined,
    },
    activeOrganizationId,
  );

  return applyHistoryProjectAllowlist(parsed, projectOptions);
}

export function buildHistoryFiltersSearchParams(
  currentSearchParams: URLSearchParams | SearchParamsLike,
  filters: HistoryFilters,
  activeOrganizationId: string | null,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(currentSearchParams.toString());
  const defaultScope = getDefaultHistoryScope(activeOrganizationId);

  if (filters.q) {
    nextSearchParams.set(HISTORY_FILTER_PARAM_KEYS.q, filters.q);
  } else {
    nextSearchParams.delete(HISTORY_FILTER_PARAM_KEYS.q);
  }

  if (filters.scope === defaultScope) {
    nextSearchParams.delete(HISTORY_FILTER_PARAM_KEYS.scope);
  } else {
    nextSearchParams.set(HISTORY_FILTER_PARAM_KEYS.scope, filters.scope);
  }

  if (filters.type) {
    nextSearchParams.set(HISTORY_FILTER_PARAM_KEYS.type, filters.type);
  } else {
    nextSearchParams.delete(HISTORY_FILTER_PARAM_KEYS.type);
  }

  if (filters.status) {
    nextSearchParams.set(HISTORY_FILTER_PARAM_KEYS.status, filters.status);
  } else {
    nextSearchParams.delete(HISTORY_FILTER_PARAM_KEYS.status);
  }

  if (filters.projectId) {
    nextSearchParams.set(
      HISTORY_FILTER_PARAM_KEYS.projectId,
      filters.projectId,
    );
  } else {
    nextSearchParams.delete(HISTORY_FILTER_PARAM_KEYS.projectId);
  }

  return nextSearchParams;
}

export function getHistoryFiltersResetKey(
  filters: HistoryFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.q ?? "all"}:${filters.scope}:${filters.type ?? "all"}:${filters.status ?? "all"}:${filters.projectId ?? "all"}`;
}
