export const TASKS_RETURN_PATH_SESSION_KEY = "sokosumi.tasks.returnPath";

export function isTasksRootPath(pathname: string) {
  return pathname === "/tasks";
}

/** Remember the board before opening a task, without reopening its create flow. */
export function storeTasksReturnPath() {
  if (
    typeof window === "undefined" ||
    !isTasksRootPath(window.location.pathname)
  ) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  for (const key of ["create", "assignee", "coworker", "prompt"]) {
    params.delete(key);
  }
  const query = params.toString();
  window.sessionStorage.setItem(
    TASKS_RETURN_PATH_SESSION_KEY,
    query ? `/tasks?${query}` : "/tasks",
  );
}

export function getStoredTasksReturnPath() {
  if (typeof window === "undefined") {
    return "/tasks";
  }

  const storedPath = window.sessionStorage.getItem(
    TASKS_RETURN_PATH_SESSION_KEY,
  );

  if (!storedPath || !storedPath.startsWith("/tasks")) {
    return "/tasks";
  }

  return storedPath;
}
