import "server-only";

import type {
  CreateProjectImageJobRequest,
  CreateProjectVideoJobRequest,
  ProjectImageJob,
  ProjectImageStudioCatalog,
  ProjectImageStudioState,
  SaveStudioBrandCopy,
  SocialPostMediaRef,
  StudioProductCatalog,
  StudioProductImport,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

interface StudioStateQuery {
  assetId?: string;
  before?: string;
  beforeId?: string;
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

  async listBatchAssets(projectId: string, batchId: string) {
    return (await coreClient.listStudioBatchAssets(projectId, batchId)).data;
  },

  async saveBrandCopy(projectId: string, input: SaveStudioBrandCopy) {
    return (await coreClient.saveStudioBrandCopy(projectId, input)).data;
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
