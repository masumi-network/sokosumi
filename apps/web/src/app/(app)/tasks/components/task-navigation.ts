export const TASKS_RETURN_PATH_SESSION_KEY = "sokosumi.tasks.returnPath";

export function isTasksRootPath(pathname: string) {
  return pathname === "/tasks";
}

/** `root` itself or `root?query`: never another page, origin or path. */
function isReturnPathFor(path: string, root: "/tasks" | "/calendar") {
  return path === root || path.startsWith(`${root}?`);
}

export function isCalendarReturnPath(path: string) {
  return isReturnPathFor(path, "/calendar");
}

/**
 * Remember the board, or the Calendar with its view, period and filters,
 * before opening a task, without reopening the board's create flow.
 */
export function storeTasksReturnPath() {
  if (typeof window === "undefined") {
    return;
  }
  const { pathname, search } = window.location;
  if (pathname === "/calendar") {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      `/calendar${search}`,
    );
    return;
  }
  if (!isTasksRootPath(pathname)) {
    return;
  }
  const params = new URLSearchParams(search);
  for (const key of ["create", "assignee", "coworker", "prompt"]) {
    params.delete(key);
  }
  const query = params.toString();
  window.sessionStorage.setItem(
    TASKS_RETURN_PATH_SESSION_KEY,
    query ? `/tasks?${query}` : "/tasks",
  );
}

/**
 * Where a task's Back goes. Only a task's own page returns to the Calendar;
 * other task pages (archived, edit) go back to the board.
 */
export function getStoredTasksReturnPath({ allowCalendar = false } = {}) {
  if (typeof window === "undefined") {
    return "/tasks";
  }

  const storedPath = window.sessionStorage.getItem(
    TASKS_RETURN_PATH_SESSION_KEY,
  );

  if (
    storedPath &&
    (isReturnPathFor(storedPath, "/tasks") ||
      (allowCalendar && isCalendarReturnPath(storedPath)))
  ) {
    return storedPath;
  }

  return "/tasks";
}
