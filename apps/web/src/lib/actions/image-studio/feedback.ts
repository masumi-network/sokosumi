"use server";

import type {
  SetStudioAssetFeedbackData,
  StudioAssetRating,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { imageStudioService } from "@/lib/services/image-studio.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const rateStudioAsset = withSession<
  AuthenticatedRequest & {
    projectId: string;
    assetId: string;
    feedback: SetStudioAssetFeedbackData["body"];
  },
  ActionResultDto<StudioAssetRating, ActionError>
>(async ({ projectId, assetId, feedback }) => {
  try {
    return toActionResult(
      ok(await imageStudioService.setFeedback(projectId, assetId, feedback)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const hideStudioAsset = withSession<
  AuthenticatedRequest & { projectId: string; assetId: string },
  ActionResultDto<null, ActionError>
>(async ({ projectId, assetId }) => {
  try {
    await imageStudioService.hideAsset(projectId, assetId);
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const recordStudioAssetView = withSession<
  AuthenticatedRequest & { projectId: string; assetId: string },
  void
>(async ({ projectId, assetId }) => {
  try {
    await imageStudioService.recordView(projectId, assetId);
  } catch {
    // A view signal must never interrupt viewing an image.
  }
});
