export type TasksViewMode = "board" | "list";

export const TASKS_VIEW_MODE_COOKIE_NAME = "tasks_view_mode";
export const TASKS_VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Kanban is the desktop default; list is easier on narrow screens. */
export const DEFAULT_TASKS_VIEW_MODE_DESKTOP: TasksViewMode = "board";
export const DEFAULT_TASKS_VIEW_MODE_MOBILE: TasksViewMode = "list";

export function parseTasksViewMode(
  value: string | null | undefined,
): TasksViewMode | null {
  if (value === "board" || value === "list") {
    return value;
  }

  return null;
}

/**
 * Cookie preference wins. Without one, mobile/tablet UA defaults to list;
 * desktop defaults to board.
 */
export function resolveDefaultTasksViewMode(options: {
  persisted: TasksViewMode | null;
  preferList: boolean;
}): TasksViewMode {
  if (options.persisted) {
    return options.persisted;
  }

  return options.preferList
    ? DEFAULT_TASKS_VIEW_MODE_MOBILE
    : DEFAULT_TASKS_VIEW_MODE_DESKTOP;
}

/** True when the request UA looks like a phone or tablet. */
export function preferTasksListFromDeviceType(
  deviceType: string | undefined,
): boolean {
  return deviceType === "mobile" || deviceType === "tablet";
}

/**
 * Client-side stand-in for Next `userAgent().device.type` mobile|tablet.
 * Used by Instant Nav loading shells that cannot call `cookies()`/`headers()`.
 */
export function preferTasksListFromUserAgent(
  userAgent: string | undefined,
): boolean {
  if (!userAgent) {
    return false;
  }

  // Tablets first (Android tablet UAs omit "Mobile").
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent)) {
    return true;
  }

  return /mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent);
}

/** Read `tasks_view_mode` from a raw Cookie header / `document.cookie` string. */
export function parseTasksViewModeCookieHeader(
  documentCookie: string,
): TasksViewMode | null {
  const match = documentCookie.match(
    new RegExp(`(?:^|;\\s*)${TASKS_VIEW_MODE_COOKIE_NAME}=([^;]*)`),
  );

  return parseTasksViewMode(match?.[1]);
}

/**
 * Client resolve for Instant Nav / Suspense skeletons: cookie wins; else
 * mobile/tablet UA → list, desktop → board (same as `getDefaultTasksViewMode`).
 */
export function resolveTasksViewModeFromClientCookie(
  documentCookie: string,
  userAgent: string | undefined,
): TasksViewMode {
  return resolveDefaultTasksViewMode({
    persisted: parseTasksViewModeCookieHeader(documentCookie),
    preferList: preferTasksListFromUserAgent(userAgent),
  });
}

export function serializeTasksViewModeCookie(mode: TasksViewMode): string {
  return `${TASKS_VIEW_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`;
}
