import "server-only";

import type {
  ApproveSocialPostRequest,
  CancelSocialPostRequest,
  CreateSocialPostRequest,
  DisconnectProjectSocialConnectionResponse,
  GetProjectsByIdCalendarData,
  GetProjectsData,
  InitiateProjectSocialConnectionRequest,
  InitiateProjectSocialConnectionResponse,
  JobSummary,
  Project,
  ProjectActivityItem,
  ProjectCloseRecoveryRequest,
  ProjectCloseRequest,
  ProjectCloseStatus,
  ProjectContextMd,
  ProjectHide,
  ProjectHideResult,
  ProjectListItem,
  ProjectSocialConnection,
  ProjectSocialConnectionPages,
  ProjectStar,
  ProjectStatsEntry,
  PublishSocialPostRequest,
  RecycleSocialAccountPostRequest,
  ResumeSocialPostThreadRequest,
  ScheduleSocialPostRequest,
  SocialPost,
  SocialPostStatus,
  StarredProject,
  TaskListItem,
  UpdateSocialPostRequest,
} from "@sokosumi/core-client";
import type { CoreApiPagination } from "@/lib/clients/core.client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

interface ListProjectsParams {
  cursor?: string | null;
  limit?: number;
  /** Case-insensitive project-name filter, applied by Core before paging. */
  query?: string;
  /**
   * Open (closing and close-failed included, the reader's Hidden projects
   * not), Hidden, or Closed; omitted lists every project.
   */
  state?: NonNullable<GetProjectsData["query"]>["state"];
  /** Lead with the reader's Pins, by `starredAt` ascending. */
  pinnedFirst?: boolean;
}

interface ListProjectResourcesParams {
  cursor?: string | null;
  limit?: number;
}

interface CreateProjectInput {
  name: string;
  identifier?: string;
  briefing?: string | null;
  websiteUrl?: string | null;
}

interface PatchProjectInput {
  name?: string;
  identifier?: string;
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
      state: params.state,
      pinnedFirst: params.pinnedFirst ? "true" : undefined,
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

  /**
   * Recent activity: the newest event per task, job and project across open
   * projects, or within one project when `projectId` is given.
   */
  async function listRecentActivity(
    limit: number,
    projectId?: string,
  ): Promise<ProjectActivityItem[]> {
    const result = await coreClient.getProjectsActivity({ limit, projectId });
    return result.data;
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

  /** Whether the reader has Hidden this project (ADR 0036). */
  async function isProjectHidden(projectId: string): Promise<boolean> {
    const result = await coreClient.getProjectHide(projectId);
    return result.data?.hiddenAt != null;
  }

  /** Hides the project for the reader, unpinning it; `unpinned` says whether it was. */
  async function hideProject(projectId: string): Promise<ProjectHideResult> {
    const result = await coreClient.hideProject(projectId);

    if (!result.data) {
      throw new Error("Failed to hide project");
    }

    return result.data;
  }

  async function showProject(projectId: string): Promise<ProjectHide> {
    const result = await coreClient.showProject(projectId);

    if (!result.data) {
      throw new Error("Failed to show project");
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
      ...(input.identifier ? { identifier: input.identifier } : {}),
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

  async function listSocialConnectionPages(
    projectId: string,
    socialConnectionId: string,
  ): Promise<ProjectSocialConnectionPages> {
    const result =
      await coreClient.getProjectsByIdSocialConnectionsByConnectionIdPages(
        projectId,
        socialConnectionId,
      );
    return result.data;
  }

  async function addSocialConnectionPage(
    projectId: string,
    socialConnectionId: string,
    externalAccountId: string,
  ): Promise<ProjectSocialConnection> {
    const result =
      await coreClient.postProjectsByIdSocialConnectionsByConnectionIdPages(
        projectId,
        socialConnectionId,
        { externalAccountId },
      );
    return result.data;
  }

  async function listSocialPosts(
    projectId: string,
    params: {
      statuses?: readonly SocialPostStatus[];
      cursor?: string | null;
      quoteCandidates?: boolean;
      excludePostId?: string;
      search?: string;
    } = {},
  ): Promise<{ posts: SocialPost[]; nextCursor: string | null }> {
    const result = await coreClient.getProjectsByIdSocialPosts(projectId, {
      status: params.statuses?.join(","),
      cursor: params.cursor ?? undefined,
      limit: 20,
      ...(params.quoteCandidates ? { quoteCandidates: "true" } : {}),
      ...(params.excludePostId ? { excludePostId: params.excludePostId } : {}),
      ...(params.search ? { search: params.search } : {}),
    });
    return {
      posts: result.data,
      nextCursor: result.meta?.pagination?.nextCursor ?? null,
    };
  }

  async function listSocialAccountStatistics(
    projectId: string,
    params: {
      provider?: SocialPost["provider"];
      connectionId?: string;
      publishedFrom?: string;
      publishedUntil?: string;
      cursor?: string;
    } = {},
  ) {
    const result = await coreClient.getProjectsByIdSocialConnectionsStatistics(
      projectId,
      {
        ...params,
        publishedFrom: params.publishedFrom
          ? new Date(params.publishedFrom)
          : undefined,
        publishedUntil: params.publishedUntil
          ? new Date(params.publishedUntil)
          : undefined,
        limit: 20,
      },
    );
    return result.data;
  }

  async function refreshSocialAccountStatistics(
    projectId: string,
    connectionId: string,
    continueHistory = false,
  ) {
    const result =
      await coreClient.postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefresh(
        projectId,
        connectionId,
        { continueHistory },
      );
    return result.data;
  }

  async function listSocialPostStatistics(
    projectId: string,
    params: {
      provider?: SocialPost["provider"];
      publishedFrom?: string;
      publishedUntil?: string;
      cursor?: string;
    } = {},
  ) {
    const result = await coreClient.getProjectsByIdSocialPostsStatistics(
      projectId,
      {
        ...params,
        publishedFrom: params.publishedFrom
          ? new Date(params.publishedFrom)
          : undefined,
        publishedUntil: params.publishedUntil
          ? new Date(params.publishedUntil)
          : undefined,
        limit: 20,
      },
    );
    return result.data;
  }

  async function refreshSocialPostStatistics(
    projectId: string,
    postId: string,
  ): Promise<SocialPost> {
    const result =
      await coreClient.postProjectsByIdSocialPostsByPostIdStatisticsRefresh(
        projectId,
        postId,
      );
    return result.data;
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

  async function duplicateSocialPost(
    projectId: string,
    postId: string,
  ): Promise<SocialPost> {
    const result =
      await coreClient.postProjectsByIdSocialPostsByPostIdDuplicate(
        projectId,
        postId,
      );
    return result.data;
  }

  async function recycleSocialAccountPost(
    projectId: string,
    accountPostId: string,
    input: RecycleSocialAccountPostRequest = {},
  ): Promise<SocialPost> {
    const result =
      await coreClient.postProjectsByIdSocialAccountPostsByAccountPostIdRecycle(
        projectId,
        accountPostId,
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

  async function approveSocialPost(
    projectId: string,
    postId: string,
    input: ApproveSocialPostRequest,
  ): Promise<SocialPost> {
    const result = await coreClient.postProjectsByIdSocialPostsByPostIdApprove(
      projectId,
      postId,
      input,
    );
    return result.data;
  }

  async function resumeSocialPostThread(
    projectId: string,
    postId: string,
    input: ResumeSocialPostThreadRequest,
  ): Promise<SocialPost> {
    const result =
      await coreClient.postProjectsByIdSocialPostsByPostIdThreadResume(
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
    getProjectCloseStatus,
    getProjectContextMd,
    getProjectCalendar,
    createProject,
    pinProject,
    unpinProject,
    listPinnedProjects,
    isProjectHidden,
    hideProject,
    showProject,
    listRecentActivity,
    patchProject,
    removeProjectDesignMd,
    listSocialConnections,
    initiateSocialConnection,
    finalizeSocialConnection,
    disconnectSocialConnection,
    listSocialConnectionPages,
    addSocialConnectionPage,
    closeProject,
    retryProjectClose,
    cancelProjectCloseOwedWork,
    listSocialPosts,
    listSocialPostStatistics,
    listSocialAccountStatistics,
    refreshSocialAccountStatistics,
    refreshSocialPostStatistics,
    getSocialPost,
    createSocialPost,
    updateSocialPost,
    scheduleSocialPost,
    cancelSocialPost,
    duplicateSocialPost,
    recycleSocialAccountPost,
    publishSocialPost,
    approveSocialPost,
    resumeSocialPostThread,
    listProjectJobs,
    listProjectTasks,
    addJob,
    removeJob,
    addTask,
    removeTask,
  };
})();
