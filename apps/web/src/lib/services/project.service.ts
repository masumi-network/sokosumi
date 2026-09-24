import "server-only";

import type { CoreApiPagination } from "@/lib/clients/core.client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  CancelSocialPostRequest,
  CreateSocialPostRequest,
  DisconnectProjectSocialConnectionResponse,
  GetProjectsByIdCalendarData,
  InitiateProjectSocialConnectionRequest,
  InitiateProjectSocialConnectionResponse,
  JobSummary,
  Project,
  ProjectCloseRecoveryRequest,
  ProjectCloseRequest,
  ProjectCloseStatus,
  ProjectContextMd,
  ProjectListItem,
  ProjectNeedsAttention,
  ProjectSocialConnection,
  ProjectStar,
  ProjectStatsEntry,
  PublishSocialPostRequest,
  ScheduleSocialPostRequest,
  SocialPost,
  SocialPostStatus,
  StarredProject,
  TaskListItem,
  UpdateSocialPostRequest,
} from "@/lib/clients/generated/core/types.gen";

interface ListProjectsParams {
  cursor?: string | null;
  limit?: number;
  /** Case-insensitive project-name filter, applied by Core before paging. */
  query?: string;
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
      q: params.query || undefined,
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

  async function getProjectNeedsAttention(
    projectId: string,
  ): Promise<ProjectNeedsAttention> {
    const result = await coreClient.getProjectsByIdNeedsAttention(projectId);
    return result.data;
  }

  async function getProjectCloseStatus(
    projectId: string,
  ): Promise<ProjectCloseStatus | null> {
    try {
      const result = await coreClient.getProjectsByIdClose(projectId);
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

  async function getProjectCalendar(
    projectId: string,
    query: GetProjectsByIdCalendarData["query"],
  ) {
    const result = await coreClient.getProjectsByIdCalendar(projectId, query);

    return {
      items: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  /**
   * Product UI says Pin; the API and database say star (ADR 0017), which is
   * why the call below reads `star` and everything around it reads `pin`.
   */
  async function pinProject(projectId: string): Promise<ProjectStar> {
    const result = await coreClient.pinProject(projectId);

    if (!result.data) {
      throw new Error("Failed to pin project");
    }

    return result.data;
  }

  async function unpinProject(projectId: string): Promise<ProjectStar> {
    const result = await coreClient.unpinProject(projectId);

    if (!result.data) {
      throw new Error("Failed to unpin project");
    }

    return result.data;
  }

  /**
   * The reader's Pinned projects, oldest Pin first. Separate from
   * `listProjects` because a Pinned project is usually a quiet one, so it
   * often sits outside the activity-ordered first page (ADR 0036).
   */
  async function listPinnedProjects(): Promise<StarredProject[]> {
    const result = await coreClient.getPinnedProjects();

    if (!result.data) {
      throw new Error("Failed to fetch pinned projects");
    }

    return result.data;
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

  async function closeProject(
    projectId: string,
    input: ProjectCloseRequest,
  ): Promise<ProjectCloseStatus> {
    const result = await coreClient.postProjectsByIdClose(projectId, input);
    return result.data;
  }

  async function retryProjectClose(
    projectId: string,
    input: ProjectCloseRecoveryRequest,
  ): Promise<ProjectCloseStatus> {
    const result = await coreClient.postProjectsByIdCloseRetry(
      projectId,
      input,
    );
    return result.data;
  }

  async function cancelProjectCloseOwedWork(
    projectId: string,
    input: ProjectCloseRecoveryRequest,
  ): Promise<ProjectCloseStatus> {
    const result = await coreClient.postProjectsByIdCloseCancelOwed(
      projectId,
      input,
    );
    return result.data;
  }

  async function listSocialConnections(
    projectId: string,
  ): Promise<ProjectSocialConnection[]> {
    const result = await coreClient.getProjectsByIdSocialConnections(projectId);
    return result.data;
  }

  async function initiateSocialConnection(
    projectId: string,
    input: InitiateProjectSocialConnectionRequest,
  ): Promise<InitiateProjectSocialConnectionResponse> {
    const result = await coreClient.postProjectsByIdSocialConnectionsInitiate(
      projectId,
      input,
    );
    return result.data;
  }

  async function finalizeSocialConnection(
    projectId: string,
    connectionId: string,
  ): Promise<ProjectSocialConnection> {
    const result = await coreClient.postProjectsByIdSocialConnectionsFinalize(
      projectId,
      { connectionId },
    );
    return result.data;
  }

  async function disconnectSocialConnection(
    projectId: string,
    socialConnectionId: string,
  ): Promise<DisconnectProjectSocialConnectionResponse> {
    const result =
      await coreClient.deleteProjectsByIdSocialConnectionsByConnectionId({
        id: projectId,
        connectionId: socialConnectionId,
      });
    return result.data;
  }

  async function listSocialPosts(
    projectId: string,
    params: {
      statuses?: readonly SocialPostStatus[];
      cursor?: string | null;
    } = {},
  ): Promise<{ posts: SocialPost[]; nextCursor: string | null }> {
    const result = await coreClient.getProjectsByIdSocialPosts(projectId, {
      status: params.statuses?.join(","),
      cursor: params.cursor ?? undefined,
      limit: 20,
    });
    return {
      posts: result.data,
      nextCursor: result.meta?.pagination?.nextCursor ?? null,
    };
  }

  async function getSocialPost(
    projectId: string,
    postId: string,
  ): Promise<SocialPost | null> {
    try {
      const result = await coreClient.getProjectsByIdSocialPostsByPostId(
        projectId,
        postId,
      );
      return result.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async function createSocialPost(
    projectId: string,
    input: CreateSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.postProjectsByIdSocialPosts(
      projectId,
      input,
    );
    return result.data;
  }

  async function updateSocialPost(
    projectId: string,
    postId: string,
    input: UpdateSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.patchProjectsByIdSocialPostsByPostId(
      projectId,
      postId,
      input,
    );
    return result.data;
  }

  async function scheduleSocialPost(
    projectId: string,
    postId: string,
    input: ScheduleSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.postProjectsByIdSocialPostsByPostIdSchedule(
      projectId,
      postId,
      input,
    );
    return result.data;
  }

  async function cancelSocialPost(
    projectId: string,
    postId: string,
    input: CancelSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.postProjectsByIdSocialPostsByPostIdCancel(
      projectId,
      postId,
      input,
    );
    return result.data;
  }

  async function publishSocialPost(
    projectId: string,
    postId: string,
    input: PublishSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.postProjectsByIdSocialPostsByPostIdPublish(
      projectId,
      postId,
      input,
    );
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
    getProjectNeedsAttention,
    getProjectCloseStatus,
    getProjectContextMd,
    getProjectCalendar,
    createProject,
    pinProject,
    unpinProject,
    listPinnedProjects,
    patchProject,
    removeProjectDesignMd,
    listSocialConnections,
    initiateSocialConnection,
    finalizeSocialConnection,
    disconnectSocialConnection,
    closeProject,
    retryProjectClose,
    cancelProjectCloseOwedWork,
    listSocialPosts,
    getSocialPost,
    createSocialPost,
    updateSocialPost,
    scheduleSocialPost,
    cancelSocialPost,
    publishSocialPost,
    listProjectJobs,
    listProjectTasks,
    addJob,
    removeJob,
    addTask,
    removeTask,
  };
})();
