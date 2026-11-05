import type { Task, TaskFile } from "@sokosumi/core-client";

/** This narrows the picker. Core repeats authorization and checks artifact ownership. */
export function seoImportFiles(
  task: Pick<Task, "id" | "assignee" | "files">,
): TaskFile[] {
  if (task.assignee?.type !== "coworker") return [];
  const coworkerId = task.assignee.id;
  return task.files.filter(
    (file) =>
      file.status === "READY" &&
      file.name === `seo-report-${task.id}.json` &&
      file.mimeType === "application/json" &&
      file.uploader?.type === "coworker" &&
      file.uploader.id === coworkerId,
  );
}

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
