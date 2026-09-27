import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  CreateProjectImageJobRequest,
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageStudioState,
  ReviewProjectImageAssetRequest,
} from "@/lib/clients/generated/core/types.gen";

/**
 * Web's view of the image studio.
 *
 * Thin by design: Core owns the data, the provider, and every access check.
 * Nothing here decides anything.
 */
export const imageStudioService = {
  async getState(
    projectId: string,
    query: { assetId?: string; before?: string; beforeId?: string } = {},
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

  async reviewAsset(
    projectId: string,
    assetId: string,
    input: ReviewProjectImageAssetRequest,
  ): Promise<ProjectImageAsset> {
    const result =
      await coreClient.postProjectsByIdImageStudioAssetsByAssetIdReview(
        projectId,
        assetId,
        input,
      );
    return result.data;
  },

  async clearAssetReview(
    projectId: string,
    assetId: string,
  ): Promise<ProjectImageAsset> {
    const result =
      await coreClient.deleteProjectsByIdImageStudioAssetsByAssetIdReview(
        projectId,
        assetId,
      );
    return result.data;
  },
};
