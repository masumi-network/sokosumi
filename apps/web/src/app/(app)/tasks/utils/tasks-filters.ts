import { TaskStatus } from "@sokosumi/database";

import type { TaskWithCoworker } from "@/lib/types/task";

export const TASKS_SCOPE_VALUES = ["owned", "workspace"] as const;

export type TasksScope = (typeof TASKS_SCOPE_VALUES)[number];

export interface TasksFilters {
  scope: TasksScope;
  coworkerId: string | null;
  status: TaskStatus | null;
}

export interface TasksFiltersSearchParams {
  scope?: string;
  coworkerId?: string;
  status?: string;
}

export const TASKS_FILTER_PARAM_KEYS = {
  scope: "scope",
  coworkerId: "coworkerId",
  status: "status",
} as const;

type SearchParamsLike = Pick<URLSearchParams, "toString">;

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isTaskStatusValue(value: string | null): value is TaskStatus {
  return (
    value !== null && Object.values(TaskStatus).includes(value as TaskStatus)
  );
}

export function getDefaultTasksScope(
  activeOrganizationId: string | null,
): TasksScope {
  return activeOrganizationId ? "workspace" : "owned";
}

export function getTasksFiltersFromSearchParams(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  coworkerOptions: ReadonlyArray<{ id: string }>,
): TasksFilters {
  const parsed = parseTasksFilters(
    {
      scope: searchParams.get(TASKS_FILTER_PARAM_KEYS.scope) ?? undefined,
      coworkerId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.coworkerId) ?? undefined,
      status: searchParams.get(TASKS_FILTER_PARAM_KEYS.status) ?? undefined,
    },
    activeOrganizationId,
  );
  const validCoworkerIds = new Set(
    coworkerOptions.map((coworker) => coworker.id),
  );
  const coworkerId =
    parsed.coworkerId && validCoworkerIds.has(parsed.coworkerId)
      ? parsed.coworkerId
      : null;

  return {
    ...parsed,
    coworkerId,
  };
}

export function parseTasksFilters(
  searchParams: TasksFiltersSearchParams,
  activeOrganizationId: string | null,
): TasksFilters {
  const defaultScope = getDefaultTasksScope(activeOrganizationId);
  const requestedScope = searchParams.scope;
  const scope =
    requestedScope &&
    TASKS_SCOPE_VALUES.includes(requestedScope as TasksScope) &&
    (requestedScope !== "workspace" || activeOrganizationId)
      ? (requestedScope as TasksScope)
      : defaultScope;
  const coworkerId = normalizeOptionalString(searchParams.coworkerId);
  const rawStatus = normalizeOptionalString(searchParams.status);
  const status = isTaskStatusValue(rawStatus) ? rawStatus : null;

  return {
    scope,
    coworkerId,
    status,
  };
}

export function buildTasksFiltersSearchParams(
  currentSearchParams: URLSearchParams | SearchParamsLike,
  filters: TasksFilters,
  activeOrganizationId: string | null,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(currentSearchParams.toString());
  const defaultScope = getDefaultTasksScope(activeOrganizationId);

  if (filters.scope === defaultScope) {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.scope);
  } else {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.scope, filters.scope);
  }

  if (filters.coworkerId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.coworkerId,
      filters.coworkerId,
    );
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.coworkerId);
  }

  if (filters.status) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.status, filters.status);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.status);
  }

  return nextSearchParams;
}

export function getTasksFiltersResetKey(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.scope}:${filters.coworkerId ?? "all"}:${filters.status ?? "all"}`;
}

export function isTaskOwnerEditable(
  task: Pick<TaskWithCoworker, "userId">,
  userId: string | null | undefined,
  filters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  const isWorkspaceScope =
    activeOrganizationId !== null && filters.scope === "workspace";

  if (!isWorkspaceScope) {
    return true;
  }

  return userId != null && task.userId === userId;
}
