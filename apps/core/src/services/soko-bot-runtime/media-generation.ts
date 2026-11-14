import { FileSourceKind } from "@sokosumi/database";
import {
  type CmoCalendarEntry,
  sokoBotGetImageInputSchema as getImageInputSchema,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { cusoDrive } from "@/services/cuso-project-files.service";
import { loadLiveResources } from "@/services/file-search.service";
import { getJob } from "@/services/image-studio-assets.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";
import {
  createImageJob,
  createVideoJob,
  reconcileProjectJobs,
} from "@/services/image-studio-jobs.service";
import { isMarketingFilePiece } from "@/services/marketing-strategy.service";
import { writeMarketingStrategyFiles } from "@/services/marketing-strategy-files.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotImageRefusedError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { studioLink } from "./media-models";
import { type RuntimeOperations } from "./operations";

/**
 * Writes the saved pieces that are not Social posts as the Project's Files
 * (an article, a page fix, ad copy, a newsletter issue) and links them to
 * the approved version. Returns how many were written.
 */
export async function writeCmoPieceFiles(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  version: { id: string },
  sent: { calendar?: unknown[] },
): Promise<number> {
  const entries = (sent.calendar ?? []) as CmoCalendarEntry[];
  if (!entries.some(isMarketingFilePiece)) return 0;
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  const drive = cuso ? await cusoDrive(cuso) : null;
  if (!drive)
    throw new SokoBotRuntimeValidationError(
      "Cuso's Files are not available, so these pieces could not be written.",
    );
  return writeMarketingStrategyFiles({ version, drive, entries });
}

/** Reference Files for an image: image Files the owner may open, in order. */
export async function imageReferenceFiles(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const drive = await runtime.ownerDrive(authorized);
  const files = await loadLiveResources({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    resourceIds: ids,
  });
  for (const id of ids) {
    const file = files.find((candidate) => candidate.id === id);
    if (
      !file ||
      file.sourceKind !== FileSourceKind.DRIVE_UPLOAD ||
      !file.mimeType?.startsWith("image/")
    )
      throw new SokoBotRuntimeValidationError(
        `File ${id} is not an image in the owner's Files; use a picture id from brandPictures, list_files or get_image`,
      );
  }
  return ids;
}

/** Starts an image in a Project's Content Studio, once checked. */
export async function generateImage(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  // Checked again here, after the reservation: a price or access change
  // since the preflight still refuses before anything is sent.
  const { input, model, settings, credits, referenceFileIds } = await runtime
    .checkImageRequest(authorized, raw, toolCallId)
    .catch((error: unknown) => {
      throw new SokoBotImageRefusedError(
        error instanceof Error ? error.message : "Image refused",
      );
    });
  const studioUrl = studioLink(input.projectId);
  let job: Awaited<ReturnType<typeof createImageJob>>;
  try {
    job = await createImageJob({
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
      sessionId: null,
      prompt: input.prompt,
      modelId: model.id,
      settings,
      referenceAssetIds: [],
      referenceFileIds,
      parentAssetId: null,
      idempotencyKey: `soko-bot:${authorized.turn.id}:${toolCallId}`,
    });
  } catch (error) {
    // The studio's refusals (no balance, too many at once) come before it
    // sends anything, and are the model's to read.
    if (error instanceof HTTPException)
      throw new SokoBotImageRefusedError(error.message);
    throw error;
  }
  return {
    jobId: job.id,
    projectId: input.projectId,
    status: job.status,
    model: model.id,
    credits,
    studioUrl,
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? "The provider did not confirm this request. Do not start it again; tell the owner."
        : "Started. An image takes about a minute; check it with get_image.",
  };
}

/** Starts a video in a Project's Content Studio, once checked. */
export async function generateVideo(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const { input, model, settings, credits, sourceAssetId } = await runtime
    .checkVideoRequest(authorized, raw, toolCallId)
    .catch((error: unknown) => {
      throw new SokoBotImageRefusedError(
        error instanceof Error ? error.message : "Video refused",
      );
    });
  let job: Awaited<ReturnType<typeof createVideoJob>>;
  try {
    job = await createVideoJob({
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
      sessionId: null,
      prompt: input.prompt,
      modelId: model.id,
      settings,
      sourceAssetId,
      idempotencyKey: `soko-bot:${authorized.turn.id}:${toolCallId}`,
    });
  } catch (error) {
    if (error instanceof HTTPException)
      throw new SokoBotImageRefusedError(error.message);
    throw error;
  }
  return {
    jobId: job.id,
    projectId: input.projectId,
    status: job.status,
    credits,
    durationSeconds: settings.durationSeconds,
    studioUrl: studioLink(input.projectId),
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? "The provider did not confirm this request. Do not start it again; tell the owner."
        : "Started. A video takes a few minutes; check it with get_video.",
  };
}

/** Where an image or video started with `generate_image` or `generate_video` has got to. */
export async function getStudioJob(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
) {
  const input = getImageInputSchema.parse(raw);
  runtime.requireImageProject(authorized, input.projectId);
  const scope = {
    projectId: input.projectId,
    workspaceId: authorized.turn.workspaceId,
    userId: actingMemberOf(authorized),
  };
  try {
    // Access before reconciling: reconciliation calls the provider, and a
    // Project id the owner cannot open must not reach it.
    await requireProjectAccess(scope);
    await reconcileProjectJobs(input.projectId);
    const job = await getJob({ ...scope, jobId: input.jobId });
    if (!job) return null;
    // A copy that fails leaves the image where it is, in the studio; the
    // bot is told there is no Files copy rather than the call failing.
    const file = job.assetId
      ? await runtime
          .imageInOwnerDrive(authorized, {
            projectId: input.projectId,
            assetId: job.assetId,
            jobId: job.id,
            prompt: job.prompt,
          })
          .catch((error: unknown) => {
            console.warn("[soko-bot] could not copy an image into Files", {
              jobId: job.id,
              error: error instanceof Error ? error.message : "unknown",
            });
            return null;
          })
      : null;
    return {
      jobId: job.id,
      status: job.status,
      failureReason: job.failureReason ?? null,
      studioUrl: studioLink(input.projectId, job.assetId),
      ...(job.assetId ? { file } : {}),
    };
  } catch (error) {
    if (error instanceof HTTPException)
      throw new SokoBotRuntimeValidationError(error.message);
    throw error;
  }
}

/**
 * A ready studio image, copied once into the owner's Files. Studio images
 * live in the studio's private store, where neither list_files nor the
 * Social tools can reach them, so "make an image and post it" failed. The
 * copy is keyed by the job, so asking again returns the same file.
 */
export async function imageInOwnerDrive(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  image: {
    projectId: string;
    assetId: string;
    jobId: string;
    prompt: string;
  },
): Promise<{ id: string; name: string; link: string } | null> {
  const drive = await runtime.ownerDrive(authorized);
  const file = await ensureStudioAssetDriveFile({
    projectId: image.projectId,
    assetId: image.assetId,
    workspaceId: drive.key.workspaceId,
    organizationId:
      drive.key.scope === "organization" ? drive.key.ownerId : null,
    userId: drive.actor.userId,
    prompt: image.prompt,
    jobId: image.jobId,
  });
  if (!file) return null;
  return { id: file.id, name: file.name, link: `/drive/files/${file.id}` };
}
