import type { Task } from "@sokosumi/core-client";

export function canImportSeoTask(
  task: Pick<Task, "projectId" | "visibility" | "status" | "ownerId">,
  projectId: string | null,
  userId: string,
) {
  return (
    task.ownerId === userId &&
    task.visibility === "PUBLIC" &&
    task.status === "COMPLETED" &&
    (task.projectId === null || task.projectId === projectId)
  );
}
