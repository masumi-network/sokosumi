import { TaskStatus, TaskTagId, TaskVisibility } from "@sokosumi/core-client";

import { isUuidString } from "@/lib/utils/uuid";
import { parseTasksSort, type TasksSort } from "./task-sort";

export const TASKS_SCOPE_VALUES = ["owned", "workspace"] as const;

export type TasksScope = (typeof TASKS_SCOPE_VALUES)[number];

/** Core's scope for Tasks the reader owns or is the assignee of. */
export const NEEDS_ME_SCOPE = "mine" as const;

/**
 * The scope a Task query runs with. Needs me reads the reader's own Tasks.
 * Mentions reads the whole workspace, because a mention is often on a
 * teammate's Task.
 */
export function tasksQueryScope(
  scope: "workspace" | "owned",
  { needsMe, mentions }: { needsMe?: boolean; mentions?: boolean },
): "workspace" | "owned" | typeof NEEDS_ME_SCOPE {
  return needsMe ? NEEDS_ME_SCOPE : mentions ? "workspace" : scope;
}

export type TasksVisibilityFilter = typeof TaskVisibility.PRIVATE | null;

export interface TasksFilters {
  scope: TasksScope;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
  visibility: TasksVisibilityFilter;
  /** A workspace tag UUID or a built-in topic ID. */
  tag?: string;
  /** Only Tasks that have sat in a waiting status for {@link STUCK_AFTER_DAYS} days or more. */
  stuck: boolean;
  /**
   * Only Tasks that wait on the reader: an input-required status, and the
   * reader owns the Task or is its assignee.
   */
  needsMe?: boolean;
  /**
   * Only Tasks where a comment mentions the reader and the reader has not
   * commented since, anywhere in the workspace.
   */
  mentions?: boolean;
  /**
   * The order the reader picked. Left out, each layout keeps its own default.
   * A view setting, not a filter: clearing filters keeps it.
   */
  sort?: TasksSort;
  /**
   * Open sub-tasks listed under each Task. A view setting like `sort`:
   * clearing filters keeps it, and it does not change which Tasks load.
   */
  subtasks?: boolean;
}

/** Days in one status after which a waiting Task counts as stuck. */
export const STUCK_AFTER_DAYS = 3;

/** Statuses go back this far before a Task counts as stuck. */
export function stuckCutoff(now: Date): Date {
  return new Date(now.getTime() - STUCK_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

export interface ProjectFilterOption {
  id: string;
  name: string;
  logo?: string | null;
  designMd?: { url: string } | null;
  briefingUrl?: string | null;
  contextMd?: { url: string; updatedAt: string | Date } | null;
  /** A CMO Project, which pickers that create inside a Project leave out. */
  cmo?: boolean;
}

/** App Router `searchParams` values can be `string | string[]` when a key is repeated. */
export type TasksFilterQueryParam = string | string[] | undefined;

export interface TasksFiltersSearchParams {
  scope?: TasksFilterQueryParam;
  assigneeId?: TasksFilterQueryParam;
  assigneeSokoBotId?: TasksFilterQueryParam;
  assigneeUserId?: TasksFilterQueryParam;
  /** @deprecated Use `assigneeId`. Kept for bookmarked URLs. */
  coworkerId?: TasksFilterQueryParam;
  status?: TasksFilterQueryParam;
  projectId?: TasksFilterQueryParam;
  visibility?: TasksFilterQueryParam;
  stuck?: TasksFilterQueryParam;
  needsMe?: TasksFilterQueryParam;
  subtasks?: TasksFilterQueryParam;
  mentions?: TasksFilterQueryParam;
  tag?: TasksFilterQueryParam;
  sort?: TasksFilterQueryParam;
}

export const TASKS_FILTER_PARAM_KEYS = {
  scope: "scope",
  assigneeId: "assigneeId",
  assigneeSokoBotId: "assigneeSokoBotId",
  assigneeUserId: "assigneeUserId",
  /** Legacy query key; read-only fallback for bookmarks. */
  coworkerId: "coworkerId",
  status: "status",
  projectId: "projectId",
  visibility: "visibility",
  stuck: "stuck",
  needsMe: "needsMe",
  subtasks: "subtasks",
  mentions: "mentions",
  tag: "tag",
  sort: "sort",
} as const;

/**
 * The keys a saved Tasks view holds: every filter, the sort and sub-tasks.
 * Not the project: the project switcher owns it.
 */
const TASKS_VIEW_PARAM_KEYS: readonly string[] = Object.values(
  TASKS_FILTER_PARAM_KEYS,
).filter((key) => key !== TASKS_FILTER_PARAM_KEYS.projectId);

/**
 * True when the URL names a view. The toolbar always writes `scope`, so only
 * a plain entry (the sidebar, a project link) names none and opens the saved view.
 */
export function hasTasksViewParams(
  params: URLSearchParams | Record<string, unknown>,
): boolean {
  return TASKS_VIEW_PARAM_KEYS.some((key) =>
    params instanceof URLSearchParams
      ? params.has(key)
      : params[key] !== undefined,
  );
}

/** The view part of a Tasks URL, as a query string to save. */
export function pickTasksViewQuery(params: URLSearchParams): string {
  const picked = new URLSearchParams();
  for (const [key, value] of params) {
    if (TASKS_VIEW_PARAM_KEYS.includes(key)) picked.append(key, value);
  }
  // One order for client and server, so equal views compare equal.
  picked.sort();
  return picked.toString();
}

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

/** Built-in topic IDs and workspace label UUIDs are disjoint. */
export function getTaskTagQuery(raw: unknown): {
  workspaceTagId?: string;
  topicTagId?: TaskTagId;
} {
  if (typeof raw !== "string") return {};
  const tag = raw.trim();
  const topicTagId = Object.values(TaskTagId).find((topic) => topic === tag);
  if (topicTagId) return { topicTagId };
  return isUuidString(tag) ? { workspaceTagId: tag.toLowerCase() } : {};
}

export function sanitizeTaskTagFilter(raw: unknown): string | undefined {
  const { workspaceTagId, topicTagId } = getTaskTagQuery(raw);
  return workspaceTagId ?? topicTagId;
}

export function sanitizeTasksVisibilityInput(
  raw: unknown,
  activeOrganizationId: string | null,
): TasksVisibilityFilter {
  if (activeOrganizationId === null) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  if (normalized === TaskVisibility.PRIVATE) {
    return TaskVisibility.PRIVATE;
  }
  return null;
}

export function getDefaultTasksScope(
  activeOrganizationId: string | null,
): TasksScope {
  // Inside an organization the board defaults to the whole workspace so
  // members see the shared board first; personal context has no workspace
  // to show, so it stays on the user's own tasks. Drives Tasks + Calendar,
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
    kind?: "coworker" | "sokoBot" | "user";
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
      assigneeUserId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.assigneeUserId) ?? undefined,
      coworkerId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.coworkerId) ?? undefined,
      status: searchParams.get(TASKS_FILTER_PARAM_KEYS.status) ?? undefined,
      projectId:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.projectId) ?? undefined,
      visibility:
        searchParams.get(TASKS_FILTER_PARAM_KEYS.visibility) ?? undefined,
      tag: searchParams.get(TASKS_FILTER_PARAM_KEYS.tag) ?? undefined,
      stuck: searchParams.get(TASKS_FILTER_PARAM_KEYS.stuck) ?? undefined,
      needsMe: searchParams.get(TASKS_FILTER_PARAM_KEYS.needsMe) ?? undefined,
      subtasks: searchParams.get(TASKS_FILTER_PARAM_KEYS.subtasks) ?? undefined,
      mentions: searchParams.get(TASKS_FILTER_PARAM_KEYS.mentions) ?? undefined,
      sort: searchParams.get(TASKS_FILTER_PARAM_KEYS.sort) ?? undefined,
    },
    activeOrganizationId,
  );
  const validCoworkerIds = new Set<string>();
  const validSokoBotIds = new Set<string>();
  const validUserIds = new Set<string>();
  for (const option of assigneeOptions) {
    if (option.kind === "sokoBot") {
      validSokoBotIds.add(option.id);
    } else if (option.kind === "user") {
      validUserIds.add(option.id);
    } else {
      validCoworkerIds.add(option.id);
    }
  }
  const assigneeSokoBotId =
    parsed.assigneeSokoBotId && validSokoBotIds.has(parsed.assigneeSokoBotId)
      ? parsed.assigneeSokoBotId
      : null;
  const assigneeUserId =
    !assigneeSokoBotId &&
    parsed.assigneeUserId &&
    validUserIds.has(parsed.assigneeUserId)
      ? parsed.assigneeUserId
      : null;
  const assigneeId =
    !assigneeSokoBotId &&
    !assigneeUserId &&
    parsed.assigneeId &&
    validCoworkerIds.has(parsed.assigneeId) &&
    !validSokoBotIds.has(parsed.assigneeId) &&
    !validUserIds.has(parsed.assigneeId)
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
    assigneeUserId,
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
  const assigneeUserId = normalizeOptionalString(searchParams.assigneeUserId);
  const rawStatus = normalizeOptionalString(searchParams.status);
  const status = sanitizeTasksStatusInput(rawStatus);
  const projectId = sanitizeProjectIdFilterInput(
    normalizeOptionalString(searchParams.projectId),
  );
  const visibility = sanitizeTasksVisibilityInput(
    firstQueryString(searchParams.visibility),
    activeOrganizationId,
  );

  return {
    scope,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    status,
    projectId,
    visibility,
    tag: sanitizeTaskTagFilter(firstQueryString(searchParams.tag)),
    stuck: sanitizeTasksStuckInput(firstQueryString(searchParams.stuck)),
    // Left out when off, like `tag`.
    ...(sanitizeTasksStuckInput(firstQueryString(searchParams.needsMe))
      ? { needsMe: true }
      : {}),
    ...(sanitizeTasksStuckInput(firstQueryString(searchParams.mentions))
      ? { mentions: true }
      : {}),
    ...withTasksSort(parseTasksSort(firstQueryString(searchParams.sort))),
    ...(sanitizeTasksStuckInput(firstQueryString(searchParams.subtasks))
      ? { subtasks: true }
      : {}),
  };
}

/** Left out when unset, so a filter set without a sort keeps its shape. */
function withTasksSort(sort: TasksSort | undefined): { sort?: TasksSort } {
  return sort ? { sort } : {};
}

/** `stuck=1` in the URL, or `true` from server-action JSON. */
export function sanitizeTasksStuckInput(raw: unknown): boolean {
  return raw === true || raw === "1";
}

export function buildTasksFiltersSearchParams(
  currentSearchParams: URLSearchParams | SearchParamsLike,
  filters: TasksFilters,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(currentSearchParams.toString());
  // Written even when it is the default: a URL the toolbar wrote names a
  // view, so the saved view does not replace it (see hasTasksViewParams).
  nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.scope, filters.scope);

  // Always drop the legacy key when writing so URLs migrate forward.
  nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.coworkerId);

  if (filters.assigneeSokoBotId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId,
      filters.assigneeSokoBotId,
    );
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeUserId);
  } else if (filters.assigneeUserId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.assigneeUserId,
      filters.assigneeUserId,
    );
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId);
  } else if (filters.assigneeId) {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.assigneeId,
      filters.assigneeId,
    );
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeUserId);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeSokoBotId);
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.assigneeUserId);
  }

  if (filters.status) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.status, filters.status);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.status);
  }

  if (filters.visibility === null) {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.visibility);
  } else {
    nextSearchParams.set(
      TASKS_FILTER_PARAM_KEYS.visibility,
      filters.visibility,
    );
  }

  if (filters.tag) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.tag, filters.tag);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.tag);
  }

  if (filters.stuck) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.stuck, "1");
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.stuck);
  }

  if (filters.needsMe) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.needsMe, "1");
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.needsMe);
  }

  if (filters.mentions) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.mentions, "1");
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.mentions);
  }

  if (filters.subtasks) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.subtasks, "1");
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.subtasks);
  }

  if (filters.sort) {
    nextSearchParams.set(TASKS_FILTER_PARAM_KEYS.sort, filters.sort);
  } else {
    nextSearchParams.delete(TASKS_FILTER_PARAM_KEYS.sort);
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

export function getTasksFiltersResetKey(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): string {
  return `${activeOrganizationId ?? "personal"}:${filters.scope}:${filters.assigneeSokoBotId ?? filters.assigneeUserId ?? filters.assigneeId ?? "all"}:${filters.status ?? "all"}:${filters.projectId ?? "all"}:${filters.visibility ?? "all"}:${filters.stuck ? "stuck" : "any"}:${filters.tag ?? "all"}${filters.needsMe ? ":needs-me" : ""}${filters.mentions ? ":mentions" : ""}${filters.sort ? `:sort-${filters.sort}` : ""}`;
}

/**
 * True when the Filters menu narrows the board past its defaults: a
 * non-default scope, an assignee, a status, private visibility, Stuck,
 * Needs me or Mentions.
 * Clear filters resets these.
 */
export function hasClearableTasksFilters(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  return (
    filters.scope !== getDefaultTasksScope(activeOrganizationId) ||
    Boolean(
      filters.assigneeId ||
        filters.assigneeSokoBotId ||
        filters.assigneeUserId ||
        filters.status ||
        filters.visibility ||
        filters.tag ||
        filters.stuck ||
        filters.needsMe ||
        filters.mentions,
    )
  );
}

/** Resets what {@link hasClearableTasksFilters} counts; the project stays. */
export function clearTasksFilters(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): TasksFilters {
  return {
    ...filters,
    scope: getDefaultTasksScope(activeOrganizationId),
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    status: null,
    visibility: null,
    tag: undefined,
    stuck: false,
    needsMe: undefined,
    mentions: undefined,
  };
}

/**
 * Determines whether to show the active filter indicator dot.
 *
 * Business logic:
 * - Organization boards: Show the dot when `scope` is "owned" or "workspace"
 *   (either explicit choice signals the board is scoped — "My Tasks" or "All
 *   workspace tasks" — as opposed to a hypothetical unfiltered view). The
 *   default here is "workspace". Also show when assigneeId, status or
 *   Stuck is set.
 *   `projectId` is owned by the project switcher, not the Filters panel.
 * - Personal boards: Show the dot only when a non-default filter is applied
 *   (assigneeId, status or Stuck). The default "owned" scope alone does
 *   not show the dot, as there's no workspace context to distinguish from.
 */
export function hasActiveTasksFilters(
  filters: TasksFilters,
  activeOrganizationId: string | null,
): boolean {
  const hasNonScopeFilter = Boolean(
    filters.assigneeId ||
      filters.assigneeSokoBotId ||
      filters.assigneeUserId ||
      filters.status ||
      filters.tag ||
      filters.stuck ||
      filters.visibility === TaskVisibility.PRIVATE,
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
