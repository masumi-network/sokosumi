import { notFound, redirect } from "next/navigation";
import { taskService } from "@/lib/services/task.service";

/**
 * An archived-task link that no longer finds an archived Task: a Task
 * restored since then opens live, anything else is not found.
 */
export async function archivedTaskMiss(taskId: string): Promise<never> {
  if (await taskService.getTaskById(taskId)) {
    redirect(`/tasks/${encodeURIComponent(taskId)}`);
  }
  notFound();
}
