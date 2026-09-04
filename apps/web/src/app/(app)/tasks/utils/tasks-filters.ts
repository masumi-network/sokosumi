import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { TaskStatus } from "@/lib/clients/generated/core";

export const TASKS_SCOPE_VALUES = ["owned", "workspace"] as const;

export type TasksScope = (typeof TASKS_SCOPE_VALUES)[number];

export interface TasksFilters {
  scope: TasksScope;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
}

export interface ProjectFilterOption {
  id: string;
  name: string;
  logo?: string | null;
  designMd?: { url: string } | null;
  briefingUrl?: string | null;
  contextMd?: { url: string; updatedAt: string | Date } | null;
}

/** App Router `searchParams` values can be `string | string[]` when a key is repeated. */
export type TasksFilterQueryParam = string | string[] | undefined;

export interface TasksFiltersSearchParams {
  scope?: TasksFilterQueryParam;
  assigneeId?: TasksFilterQueryParam;
  assigneeSokoBotId?: TasksFilterQueryParam;
  /** @deprecated Use `assigneeId`. Kept for bookmarked URLs. */
  coworkerId?: TasksFilterQueryParam;
  status?: TasksFilterQueryParam;
  projectId?: TasksFilterQueryParam;
}

export const TASKS_FILTER_PARAM_KEYS = {
  scope: "scope",
  assigneeId: "assigneeId",
  assigneeSokoBotId: "assigneeSokoBotId",
  /** Legacy query key; read-only fallback for bookmarks. */
  coworkerId: "coworkerId",
  status: "status",
  projectId: "projectId",
} as const;

type SearchParamsLike = Pick<URLSearchParams, "toString">;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `URLSearchParams#get`: first value wins when the key is repeated. */
export function firstQueryString(
  value: TasksFilterQueryParam,
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string");
    return first;
  }
  return value;
}

export function normalizeOptionalString(
  value: TasksFilterQueryParam,
): string | null {
  const raw = firstQueryString(value);
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

function isTaskStatusValue(value: string | null): value is TaskStatus {
  return (
    value !== null && Object.values(TaskStatus).includes(value as TaskStatus)
  );
}

/**
 * Validates `status` from untrusted input (e.g. server-action JSON). Mirrors
 * {@link parseTasksFilters} so URL state and load-more stay aligned.
 */
export function sanitizeTasksStatusInput(raw: unknown): TaskStatus | null {
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
  return isTaskStatusValue(normalized) ? normalized : null;
}

export function sanitizeProjectIdFilterInput(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function getDefaultTasksScope(
  activeOrganizationId: string | null,
): TasksScope {
  // Inside an organization the board defaults to the whole workspace so
  // members see the shared board first; personal context has no workspace
  // to show, so it stays on the user's own tasks. Drives Tasks + Jobs,
  // server render + client, and the initial fetch (scope feeds the query).
  return activeOrganizationId !== null ? "workspace" : "owned";
}

/**
 * Validates `scope` from untrusted input (e.g. server-action JSON). Mirrors
 * {@link parseTasksFilters} so URL state and load-more stay aligned.
 */
export function sanitizeTasksScopeInput(
  raw: unknown,
  activeOrganizationId: string | null,
): TasksScope {
  const defaultScope = getDefaultTasksScope(activeOrganizationId);
  if (typeof raw !== "string") {
    return defaultScope;
  }
  const requestedScope = raw.trim();
  if (
    !requestedScope ||
    !TASKS_SCOPE_VALUES.includes(requestedScope as TasksScope)
  ) {
    return defaultScope;
  }
  if (requestedScope === "workspace" && !activeOrganizationId) {
    return defaultScope;
  }
  return requestedScope as TasksScope;
}

export function getTasksFiltersFromSearchParams(
  searchParams: URLSearchParams,
  activeOrganizationId: string | null,
  assigneeOptions: ReadonlyArray<{
    id: string;
    kind?: "coworker" | "sokoBot";
  }>,
  projectOptions?: ReadonlyArray<ProjectFilterOption>,
): TasksFilters {
  const parsed = parseTasksFilters(
    {
      scope: searchParams.get(TASKS_FILTER_PARAM_KEYS.scope) ?? undefined,
      assigneeId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.assigneeId) ?? undefined,
      assigneeSokoBotId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId) ??
        undefined,
      coworkerId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.coworkerId) ?? undefined,
      status: searchParams.get(TASKS_FILTER_PARAM_KEYS.status) ?? undefined,
      projectId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.projectId) ?? undefined,
    },
    activeOrganizationId,
  );
  const validCoworkerIds = new Set<string>();
  const validSokoBotIds = new Set<string>();
  for (const option of assigneeOptions) {
    if (option.kind === "sokoBot") {
      validSokoBotIds.add(option.id);
    } else {
      validCoworkerIds.add(option.id);
    }
  }
  const assigneeSokoBotId =
    parsed.assigneeSokoBotId && validSokoBotIds.has(parsed.assigneeSokoBotId)
      ? parsed.assigneeSokoBotId
      : null;
  const assigneeId =
    !assigneeSokoBotId &&
    parsed.assigneeId &&
    validCoworkerIds.has(parsed.assigneeId) &&
    !validSokoBotIds.has(parsed.assigneeId)
      ? parsed.assigneeId
      : null;
  const projectId =
    projectOptions === undefined ||
    (parsed.projectId &&
      projectOptions.some((project) => project.id === parsed.projectId))
      ? parsed.projectId
      : null;

  return {
    ...parsed,
    assigneeId,
    assigneeSokoBotId,
    projectId,
  };
}

export function parseTasksFilters(
  searchParams: TasksFiltersSearchParams,
  activeOrganizationId: string | null,
): TasksFilters {
  const scope = sanitizeTasksScopeInput(
    firstQueryString(searchParams.scope),
    activeOrganizationId,
  );
  // Prefer assigneeId; fall back to deprecated coworkerId for bookmarked URLs.
  const assigneeId =
    normalizeOptionalString(searchParams.assigneeId) ??
    normalizeOptionalString(searchParams.coworkerId);
  const assigneeSokoBotId = normalizeOptionalString(
    searchParams.assigneeSokoBotId,
  );
  const rawStatus = normalizeOptionalString(searchParams.status);
  const status = sanitizeTasksStatusInput(rawStatus);
  const projectId = sanitizeProjectIdFilterInput(
    normalizeOptionalString(searchParams.projectId),
  );

  return {
    scope,
    assigneeId,
    assigneeSokoBotId,
    status,
    projectId,
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

  // Always drop the legacy key when writing so URLs migrate forward.
  nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.coworkerId);

  if (filters.assigneeSokoBotId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId,
      filters.assigneeSokoBotId,
    );
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeId);
  } else if (filters.assigneeId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.assigneeId,
      filters.assigneeId,
    );
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId);
  }

  if (filters.status) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.status, filters.status);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.status);
  }

  return applyProjectIdSearchParam(nextSearchParams, filters.projectId);
}

export function applyProjectIdSearchParam(
  currentSearchParams: URLSearchParams | SearchParamsLike,
  projectId: string | null,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(currentSearchParams.toString());

  if (projectId) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.projectId, projectId);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.projectId);
  }

  return nextSearchParams;
}

export function mergeProjectFilterOptions(
  primary: readonly ProjectFilterOption[],
  extra: readonly ProjectFilterOption[],
): ProjectFilterOption[] {
  const seen = new Set<string>();
  const next: ProjectFilterOption[] = [];

  for (const project of [...primary, ...extra]) {
    if (seen.has(project.id)) {
      continue;
    }
    seen.add(project.id);
    next.push(project);
  }

  return next;
}

export function getTasksFiltersResetKey(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.scope}:${filters.assigneeSokoBotId ?? filters.assigneeId ?? "all"}:${filters.status ?? "all"}:${filters.projectId ?? "all"}`;
}

/**
 * Determines whether to show the active filter indicator dot.
 *
 * Business logic:
 * - Organization boards: Show the dot when `scope` is "owned" or "workspace"
 *   (either explicit choice signals the board is scoped — "My Tasks" or "All
 *   workspace tasks" — as opposed to a hypothetical unfiltered view). The
 *   default here is "workspace". Also show when assigneeId or status is set.
 *   `projectId` is owned by the project switcher, not the Filters panel.
 * - Personal boards: Show the dot only when a non-default filter is applied
 *   (assigneeId or status). The default "owned" scope alone does
 *   not show the dot, as there's no workspace context to distinguish from.
 */
export function hasActiveTasksFilters(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  const hasNonScopeFilter = Boolean(
    filters.assigneeId || filters.assigneeSokoBotId || filters.status,
  );

  if (activeOrganizationId !== null) {
    return (
      filters.scope === "owned" ||
      filters.scope === "workspace" ||
      hasNonScopeFilter
    );
  }

  return hasNonScopeFilter;
}

export function isTaskOwnerEditable(
  task: Pick<TaskWithCoworker, "ownerId">,
  sessionUserId: string | null | undefined,
  filters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  const isWorkspaceScope =
    activeOrganizationId !== null && filters.scope === "workspace";

  if (!isWorkspaceScope) {
    return true;
  }

  return sessionUserId != null && task.ownerId === sessionUserId;
}

/**
 * Drag permissions must stay consistent with both the URL (route) and the last
 * server render (initial). When those disagree during a filter transition,
 * `isTaskOwnerEditable` can be wrong for stale list rows (e.g. workspace rows
 * while the URL already says owned). Require both to allow drag.
 */
export function isTaskDraggableForViewFilters(
  task: Pick<TaskWithCoworker, "ownerId">,
  sessionUserId: string | null | undefined,
  routeFilters: TasksFilters,
  initialFilters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  return (
    isTaskOwnerEditable(
      task,
      sessionUserId,
      routeFilters,
      activeOrganizationId,
    ) &&
    isTaskOwnerEditable(
      task,
      sessionUserId,
      initialFilters,
      activeOrganizationId,
    )
  );
}
