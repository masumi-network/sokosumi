import "server-only";

import type { CoreApiPagination } from "@/lib/clients/core.client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  JobSummary,
  Project,
  ProjectContextMd,
  ProjectDeleted,
  ProjectListItem,
  ProjectStatsEntry,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";

interface ListProjectsParams {
  cursor?: string | null;
  limit?: number;
}

interface ListProjectResourcesParams {
  cursor?: string | null;
  limit?: number;
}

interface CreateProjectInput {
  name: string;
  briefing?: string | null;
  websiteUrl?: string | null;
}

interface PatchProjectInput {
  name?: string;
  briefing?: string | null;
  websiteUrl?: string | null;
  logo?: string | null;
}

export const projectService = (() => {
  async function listProjects(params: ListProjectsParams = {}): Promise<{
    projects: ProjectListItem[];
    pagination: CoreApiPagination | null;
  }> {
    const result = await coreClient.getProjects({
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      projects: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function getProjectsStats(
    projectIds?: string[],
  ): Promise<ProjectStatsEntry[]> {
    if (projectIds && projectIds.length === 0) {
      return [];
    }

    const result = await coreClient.getProjectsStats({
      projectIds,
    });

    return result.data.projects;
  }

  async function getProjectById(projectId: string): Promise<Project | null> {
    try {
      const result = await coreClient.getProjectsById(projectId);
      return result.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async function getProjectContextMd(
    projectId: string,
  ): Promise<ProjectContextMd | null> {
    try {
      const result = await coreClient.getProjectsByIdContextMd(projectId);
      return result.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async function createProject(input: CreateProjectInput): Promise<Project> {
    const result = await coreClient.postProjects({
      name: input.name,
      briefing: input.briefing ?? null,
      websiteUrl: input.websiteUrl ?? null,
    });

    if (!result.data) {
      throw new Error("Failed to create project");
    }

    return result.data;
  }

  async function patchProject(
    projectId: string,
    input: PatchProjectInput,
  ): Promise<Project> {
    const result = await coreClient.patchProjectsById(projectId, input);

    if (!result.data) {
      throw new Error("Failed to update project");
    }

    return result.data;
  }

  async function removeProjectDesignMd(projectId: string): Promise<Project> {
    const result = await coreClient.deleteProjectsByIdDesignMd(projectId);

    if (!result.data) {
      throw new Error("Failed to remove project DESIGN.md");
    }

    return result.data;
  }

  async function deleteProject(projectId: string): Promise<ProjectDeleted> {
    const result = await coreClient.deleteProjectsById(projectId);

    if (!result.data) {
      throw new Error("Failed to delete project");
    }

    return result.data;
  }

  async function listProjectJobs(
    projectId: string,
    params: ListProjectResourcesParams = {},
  ): Promise<{
    jobs: JobSummary[];
    pagination: CoreApiPagination | null;
  }> {
    const result = await coreClient.getJobs({
      scope: "workspace",
      projectId,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      jobs: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function listProjectTasks(
    projectId: string,
    params: ListProjectResourcesParams = {},
  ): Promise<{
    tasks: TaskListItem[];
    pagination: CoreApiPagination | null;
  }> {
    const result = await coreClient.getTasks({
      scope: "workspace",
      projectId,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      tasks: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function addJob(projectId: string, jobId: string): Promise<Project> {
    const result = await coreClient.postProjectsByIdJobs(projectId, {
      jobId,
    });

    if (!result.data) {
      throw new Error("Failed to add job to project");
    }

    return result.data;
  }

  async function removeJob(projectId: string, jobId: string): Promise<Project> {
    const result = await coreClient.deleteProjectsByIdJobsByJobId({
      id: projectId,
      jobId,
    });

    if (!result.data) {
      throw new Error("Failed to remove job from project");
    }

    return result.data;
  }

  async function addTask(projectId: string, taskId: string): Promise<Project> {
    const result = await coreClient.postProjectsByIdTasks(projectId, {
      taskId,
    });

    if (!result.data) {
      throw new Error("Failed to add task to project");
    }

    return result.data;
  }

  async function removeTask(
    projectId: string,
    taskId: string,
  ): Promise<Project> {
    const result = await coreClient.deleteProjectsByIdTasksByTaskId({
      id: projectId,
      taskId,
    });

    if (!result.data) {
      throw new Error("Failed to remove task from project");
    }

    return result.data;
  }

  return {
    listProjects,
    getProjectsStats,
    getProjectById,
    getProjectContextMd,
    createProject,
    patchProject,
    removeProjectDesignMd,
    deleteProject,
    listProjectJobs,
    listProjectTasks,
    addJob,
    removeJob,
    addTask,
    removeTask,
  };
})();
