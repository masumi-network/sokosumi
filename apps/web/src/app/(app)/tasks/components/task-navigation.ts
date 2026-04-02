export const TASKS_RETURN_PATH_SESSION_KEY = "sokosumi.tasks.returnPath";

export function isTasksRootPath(pathname: string) {
  return pathname === "/tasks";
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
