import { z } from "@hono/zod-openapi";
import { productBrief } from "@sokosumi/utils";

import { getWebAppBaseUrl } from "@/config/env";
import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { imageModel, resolveImageSettings } from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import { IMAGE_PROMPT_MAX_LENGTH } from "@/lib/image-studio/request-validation";
import type { requireStudioConnection } from "@/lib/image-studio/studio-connection";
import {
  studioAdPlacementRatioSchema,
  studioHeadlineTextSchema,
} from "@/schemas/project-image-studio.schema";
import { getJob } from "@/services/image-studio-assets.service";
import {
  createImageJob,
  DEFAULT_SETTINGS,
  reconcileJob,
} from "@/services/image-studio-jobs.service";
import {
  copyRemoteStudioProductPhoto,
  readStudioProductCatalog,
} from "@/services/studio-product-catalog.service";

export type StudioConnectionAccess = Awaited<
  ReturnType<typeof requireStudioConnection>
>;

export const generationInput = z
  .object({
    requestId: z
      .uuid()
      .describe(
        "New UUID for this ad. Reuse it if the same submission needs retrying.",
      ),
    productId: z.uuid(),
    placement: studioAdPlacementRatioSchema,
    prompt: z.string().trim().min(1).max(IMAGE_PROMPT_MAX_LENGTH),
    approvedHeadline: studioHeadlineTextSchema.optional(),
    campaignId: z
      .uuid()
      .optional()
      .describe(
        "Use the same UUID for ads that should appear in one campaign.",
      ),
  })
  .strict();

function idempotencyPrefix(access: StudioConnectionAccess) {
  return `studio-mcp:${access.userId}:`;
}

export function studioAdOptions(access: StudioConnectionAccess) {
  const model = imageModel(undefined);
  return {
    model: model.label,
    remainingCredits: access.generationCreditsRemaining,
    placements: studioAdPlacementRatioSchema.options
      .filter((aspectRatio) => model.aspectRatios.includes(aspectRatio))
      .map((aspectRatio) => ({
        aspectRatio,
        credits: creditsPerImage(model, { ...DEFAULT_SETTINGS, aspectRatio }),
      })),
  };
}

export async function generateStudioAd(
  access: StudioConnectionAccess,
  input: z.infer<typeof generationInput>,
) {
  const { userId, projectId, workspaceId, organizationId } = access;
  const idempotencyKey =
    idempotencyPrefix(access) + input.requestId.toLowerCase();
  const replay = await prisma.projectImageJob.findFirst({
    where: { projectId, idempotencyKey, requestedByUserId: userId },
    select: { id: true },
  });
  if (replay) return readStudioAdStatus(access, replay.id);

  const { products } = await readStudioProductCatalog(projectId);
  const product = products.find(({ id }) => id === input.productId);
  if (!product)
    throw notFound("Choose a saved product in the connected project.");
  const prompt = [input.prompt, productBrief(product)].join("\n\n");
  if (prompt.length > IMAGE_PROMPT_MAX_LENGTH)
    throw unprocessableEntity(
      "Shorten the prompt to leave room for the saved product brief.",
    );

  const settings = resolveImageSettings(
    undefined,
    { ...DEFAULT_SETTINGS, aspectRatio: input.placement },
    product.photo || product.imageUrl ? 1 : 0,
  );
  const credits = creditsPerImage(imageModel(undefined), settings);
  if (access.generationCreditsRemaining < credits)
    throw forbidden(
      `This ad needs ${credits} credits. The connection has ${access.generationCreditsRemaining} remaining.`,
    );

  const photo =
    product.photo ??
    (product.imageUrl
      ? await copyRemoteStudioProductPhoto({
          userId,
          workspaceId,
          organizationId,
          name: product.name,
          imageUrl: product.imageUrl,
        })
      : null);
  const job = await createImageJob({
    userId,
    projectId,
    workspaceId,
    sessionId: null,
    prompt,
    product: { id: product.id, name: product.name },
    batchId: input.campaignId,
    exportHeadline: input.approvedHeadline,
    settings,
    referenceAssetIds: [],
    referenceFileIds: photo ? [photo.id] : [],
    referenceFileActor: { kind: "interactive", userId, organizationId },
    parentAssetId: null,
    idempotencyKey,
    studioConnectionKeyHash: access.keyHash,
  });
  return {
    jobId: job.id,
    status: job.status,
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? "The provider did not confirm the request. Check status and do not generate a replacement unless the user asks."
        : "Use get_ad_status to check the result. Studio charges when an image is delivered.",
  };
}

export async function readStudioAdStatus(
  access: StudioConnectionAccess,
  jobId: string,
) {
  const ownJob = await prisma.projectImageJob.findFirst({
    where: {
      id: jobId,
      projectId: access.projectId,
      requestedByUserId: access.userId,
      idempotencyKey: { startsWith: idempotencyPrefix(access) },
    },
    select: { id: true },
  });
  if (!ownJob) throw notFound("Ad request not found in this connection.");
  await reconcileJob(jobId);
  const job = await getJob({ ...access, jobId });
  if (!job) throw notFound("Ad request not found in this connection.");
  const url = new URL("/studio", getWebAppBaseUrl());
  url.searchParams.set("projectId", access.projectId);
  if (job.assetId) url.searchParams.set("v", job.assetId);
  return {
    jobId,
    status: job.status,
    assetId: job.assetId,
    failureReason: job.failureReason,
    retryMayDuplicateCharge: job.retryMayDuplicateCharge,
    credits: job.credits,
    studioUrl: url.href,
  };
}
