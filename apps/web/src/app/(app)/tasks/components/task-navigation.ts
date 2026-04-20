export const TASKS_RETURN_PATH_SESSION_KEY = "sokosumi.tasks.returnPath";
export const TASKS_ORDER_SESSION_KEY = "sokosumi.tasks.order";

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

export function storeTaskOrder(taskIds: string[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    TASKS_ORDER_SESSION_KEY,
    JSON.stringify(taskIds),
  );
}

export function getNextTaskId(currentTaskId: string): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.sessionStorage.getItem(TASKS_ORDER_SESSION_KEY);
  if (!stored) return null;
  try {
    const ids: string[] = JSON.parse(stored);
    const currentIndex = ids.indexOf(currentTaskId);
    if (currentIndex === -1 || currentIndex >= ids.length - 1) return null;
    return ids[currentIndex + 1];
  } catch {
    return null;
  }
}
