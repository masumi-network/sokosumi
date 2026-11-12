export const TASKS_RETURN_PATH_SESSION_KEY = "sokosumi.tasks.returnPath";
/** The task a stored Calendar return belongs to (`/tasks/<id>`). */
export const TASKS_RETURN_TASK_SESSION_KEY = "sokosumi.tasks.returnTask";

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
 * before opening a task, without reopening the board's create flow. The
 * Calendar is remembered for `taskPath` only: another task reached later
 * (a notification, a pasted link) goes back to the board.
 */
export function storeTasksReturnPath(taskPath?: string) {
  if (typeof window === "undefined") {
    return;
  }
  const { pathname, search } = window.location;
  if (pathname === "/calendar") {
    if (taskPath) {
      window.sessionStorage.setItem(
        TASKS_RETURN_PATH_SESSION_KEY,
        `/calendar${search}`,
      );
      window.sessionStorage.setItem(TASKS_RETURN_TASK_SESSION_KEY, taskPath);
    }
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
 * Where a task's Back goes. Only the task opened from the Calendar
 * (`taskPath`, its page's pathname) returns there; every other page goes
 * back to the board.
 */
export function getStoredTasksReturnPath({
  taskPath,
}: {
  taskPath?: string;
} = {}) {
  if (typeof window === "undefined") {
    return "/tasks";
  }

  const storedPath = window.sessionStorage.getItem(
    TASKS_RETURN_PATH_SESSION_KEY,
  );

  if (
    storedPath &&
    (isReturnPathFor(storedPath, "/tasks") ||
      (taskPath !== undefined &&
        isCalendarReturnPath(storedPath) &&
        window.sessionStorage.getItem(TASKS_RETURN_TASK_SESSION_KEY) ===
          taskPath))
  ) {
    return storedPath;
  }

  return "/tasks";
}
