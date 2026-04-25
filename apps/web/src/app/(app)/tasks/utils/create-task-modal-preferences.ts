/**
 * Last coworker picked in the "new task" modal (`CreateTaskModal` / `TaskForm` variant modal).
 * Separate from chat welcome prefs (`sokosumi-welcome-compose-prefs`) and draft keys.
 */
export const CREATE_TASK_MODAL_LAST_COWORKER_STORAGE_KEY =
  "sokosumi-tasks-create-modal-last-coworker-id";

export function readCreateTaskModalLastCoworkerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      CREATE_TASK_MODAL_LAST_COWORKER_STORAGE_KEY,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCreateTaskModalLastCoworkerId(coworkerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CREATE_TASK_MODAL_LAST_COWORKER_STORAGE_KEY,
      JSON.stringify(coworkerId),
    );
  } catch {
    // Ignore quota / private mode.
  }
}
