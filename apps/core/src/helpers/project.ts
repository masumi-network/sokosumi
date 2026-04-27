import type { ProjectWithJobsTasks } from "@/lib/repository";

export function mapProject(project: ProjectWithJobsTasks) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    jobIds: project.jobs.map((row) => row.id),
    taskIds: project.tasks.map((row) => row.id),
  };
}
