import "server-only";

import type {
  CreateProjectImageJobRequest,
  CreateProjectTalkingVideoJobRequest,
  CreateProjectVideoJobRequest,
  GetProjectsByIdImageStudioTalkingVideosData,
  GetProjectsByIdImageStudioTalkingVideosResponses,
  ImageStudioRecentProjects,
  ProjectImageJob,
  ProjectImageStudioCatalog,
  ProjectImageStudioState,
  ProjectTalkingVideoScripts,
  SaveStudioBrandCopy,
  SaveStudioBrandLook,
  SaveStudioPairwisePick,
  SetStudioAssetFeedbackData,
  SocialPostMediaRef,
  StudioProductCatalog,
  StudioProductImport,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

export type TalkingVideoPage =
  GetProjectsByIdImageStudioTalkingVideosResponses[200]["data"];

interface StudioStateQuery {
  assetId?: string;
  before?: string;
  beforeId?: string;
  sort?: "newest" | "best";
}

/**
 * Web's view of the image studio.
 *
 * Thin by design: Core owns the data, the provider, and every access check.
 * Nothing here decides anything.
 */
export const imageStudioService = {
  /**
   * The model catalog, off the polling path.
   *
   * Read once per page render and handed down as a prop. It is ~158KB for 152
   * models and it used to be part of `getState`, which the open studio refetches
   * every three seconds — so a reader sat on the page re-downloaded the whole
   * catalog twenty times a minute to learn nothing new.
   */
  async getCatalog(): Promise<ProjectImageStudioCatalog> {
    const result = await coreClient.getImageStudioCatalog();
    return result.data;
  },

  /** Empty for a workspace with no Studio images yet. */
  async getRecentProjects(): Promise<ImageStudioRecentProjects["projects"]> {
    const result = await coreClient.getImageStudioRecentProjects();
    return result.data.projects;
  },

  async getState(
    projectId: string,
    query: StudioStateQuery = {},
  ): Promise<ProjectImageStudioState> {
    // The generated client types `before` as the transformed `Date`; on the
    // wire it is the ISO string the caller already holds.
    const result = await coreClient.getProjectsByIdImageStudio(
      projectId,
      query as unknown as {
        assetId?: string;
        before?: Date;
        beforeId?: string;
        sort?: "newest" | "best";
      },
    );
    return result.data;
  },

  async attachProductPhoto(
    projectId: string,
    input: { name: string; imageUrl: string },
  ): Promise<StudioProductPhoto> {
    const result = await coreClient.attachStudioProductPhoto(projectId, input);
    return result.data;
  },

  async getBrandKit(projectId: string) {
    return (await coreClient.getStudioBrandKit(projectId)).data;
  },

  async getWebsiteCopy(projectId: string) {
    return (await coreClient.getStudioWebsiteCopy(projectId)).data;
  },

  async prepareWebsiteDraft(projectId: string) {
    return (await coreClient.prepareStudioWebsiteDraft(projectId)).data;
  },

  async saveAdHeadline(
    projectId: string,
    assetId: string,
    text: string | null,
  ) {
    return (await coreClient.saveStudioAdHeadline(projectId, assetId, text))
      .data;
  },

  async setFeedback(
    projectId: string,
    assetId: string,
    input: SetStudioAssetFeedbackData["body"],
  ) {
    return (await coreClient.setStudioAssetFeedback(projectId, assetId, input))
      .data;
  },

  async hideAsset(projectId: string, assetId: string) {
    await coreClient.hideStudioAsset(projectId, assetId);
  },

  async recordView(projectId: string, assetId: string) {
    await coreClient.recordStudioAssetEvent(projectId, assetId);
  },

  async listBatchAssets(projectId: string, batchId: string) {
    return (await coreClient.listStudioBatchAssets(projectId, batchId)).data;
  },

  async getComparePair(projectId: string, batchId: string) {
    return (await coreClient.getStudioComparePair(projectId, batchId)).data;
  },

  async savePairwisePick(
    projectId: string,
    batchId: string,
    input: SaveStudioPairwisePick,
  ) {
    return (await coreClient.saveStudioPairwisePick(projectId, batchId, input))
      .data;
  },

  async getModelScoreboard(projectId: string) {
    return (await coreClient.getStudioModelScoreboard(projectId)).data;
  },

  async saveBrandCopy(projectId: string, input: SaveStudioBrandCopy) {
    return (await coreClient.saveStudioBrandCopy(projectId, input)).data;
  },

  async saveBrandLook(projectId: string, input: SaveStudioBrandLook) {
    return (await coreClient.saveStudioBrandLook(projectId, input)).data;
  },

  async uploadProjectLogo(projectId: string, file: File) {
    return (await coreClient.uploadStudioProjectLogo(projectId, file)).data;
  },

  async findWebsiteLogo(projectId: string) {
    return (await coreClient.findStudioWebsiteLogo(projectId)).data;
  },

  async getProductCatalog(projectId: string): Promise<StudioProductCatalog> {
    const result = await coreClient.getStudioProductCatalog(projectId);
    return result.data;
  },

  async replaceProductCatalog(
    projectId: string,
    input: StudioProductCatalog,
  ): Promise<StudioProductCatalog> {
    const result = await coreClient.replaceStudioProductCatalog(
      projectId,
      input,
    );
    return result.data;
  },

  async importProducts(
    projectId: string,
    url: string,
  ): Promise<StudioProductImport> {
    const result = await coreClient.importStudioProductCatalog(projectId, {
      url,
    });
    return result.data;
  },

  async createJob(
    projectId: string,
    input: CreateProjectImageJobRequest,
  ): Promise<ProjectImageJob> {
    const result = await coreClient.postProjectsByIdImageStudioJobs(
      projectId,
      input,
    );
    return result.data;
  },

  async createVideoJob(
    projectId: string,
    input: CreateProjectVideoJobRequest,
  ): Promise<ProjectImageJob> {
    const result = await coreClient.postProjectsByIdImageStudioVideoJobs(
      projectId,
      input,
    );
    return result.data;
  },

  async createTalkingVideoJob(
    projectId: string,
    input: CreateProjectTalkingVideoJobRequest,
  ): Promise<ProjectImageJob> {
    const result = await coreClient.postProjectsByIdImageStudioTalkingVideoJobs(
      projectId,
      input,
    );
    return result.data;
  },

  /** Answering this settles finished talking videos, like `getState`. */
  async getTalkingVideos(
    projectId: string,
    query?: GetProjectsByIdImageStudioTalkingVideosData["query"],
    signal?: AbortSignal,
  ): Promise<TalkingVideoPage> {
    const result = await coreClient.getProjectsByIdImageStudioTalkingVideos(
      projectId,
      query,
      signal,
    );
    return result.data;
  },

  async writeTalkingVideoScripts(
    projectId: string,
    input: { topic?: string; languageCode: string },
  ): Promise<ProjectTalkingVideoScripts["scripts"]> {
    const result =
      await coreClient.postProjectsByIdImageStudioTalkingVideoScripts(
        projectId,
        input,
      );
    return result.data.scripts;
  },

  async cancelJob(
    projectId: string,
    jobId: string,
  ): Promise<{ accepted: boolean }> {
    const result =
      await coreClient.postProjectsByIdImageStudioJobsByJobIdCancel(
        projectId,
        jobId,
      );
    return result.data;
  },

  async getSocialMedia(
    projectId: string,
    assetId: string,
  ): Promise<SocialPostMediaRef> {
    const result =
      await coreClient.getProjectsByIdImageStudioAssetsByAssetIdSocialMedia(
        projectId,
        assetId,
      );
    return result.data;
  },

  async writeCaption(
    projectId: string,
    assetId: string,
  ): Promise<{ text: string }> {
    const result =
      await coreClient.postProjectsByIdImageStudioAssetsByAssetIdCaption(
        projectId,
        assetId,
      );
    return result.data;
  },
};
