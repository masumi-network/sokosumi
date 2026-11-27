import { FileSourceKind } from "@sokosumi/database";
import {
  type CmoCalendarEntry,
  sokoBotGenerateImageInputSchema as generateImageInputSchema,
  sokoBotGetImageInputSchema as getImageInputSchema,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { createCoreLogger, logCoreWarning } from "@/lib/evlog";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { DEFAULT_TALKING_VIDEO_VOICE } from "@/lib/image-studio/talking-video";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { resolveProjectTargetForWrite } from "@/lib/soko-bot/target-resolver";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import {
  cmoStylePrompt,
  finishCmoChatPicture,
  loadStyleBrand,
  REFERENCE_STYLE_MODELS,
} from "@/services/cmo-media-maker.service";
import { talkingVideoPresenter } from "@/services/cmo-presenter.service";
import { cusoDrive } from "@/services/cuso-project-files.service";
import { loadLiveResources } from "@/services/file-search.service";
import { getJob } from "@/services/image-studio-assets.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";
import {
  createImageJob,
  createTalkingVideoJob,
  createVideoJob,
  DEFAULT_SETTINGS,
  reconcileProjectJobs,
} from "@/services/image-studio-jobs.service";
import { isMarketingFilePiece } from "@/services/marketing-strategy.service";
import { writeMarketingStrategyFiles } from "@/services/marketing-strategy-files.service";
import { readStyleTraits } from "@/services/reference-library.service";
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

function rawProjectId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || !("projectId" in raw))
    return undefined;
  const value = (raw as { projectId?: unknown }).projectId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Starts an image in a Project's Content Studio, once checked. */
export async function generateImage(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const projectTarget = await resolveProjectTargetForWrite(authorized, {
    projectId: rawProjectId(raw),
    mode: "studio_media",
    capability: "generate_image",
  });
  // Checked again here, after the reservation: a price or access change
  // since the preflight still refuses before anything is sent.
  const { input, model, settings, credits, referenceFileIds, style } =
    await runtime
      .checkImageRequest(authorized, raw, toolCallId)
      .catch((error: unknown) => {
        throw new SokoBotImageRefusedError(
          error instanceof Error ? error.message : "Image refused",
        );
      });
  const cuso = style ? await findCusoForBot(authorized.turn.sokoBotId) : null;
  if (style && !cuso)
    throw new SokoBotImageRefusedError("This bot has no CMO Project.");
  const brand = style && cuso ? await loadStyleBrand(cuso.projectId) : null;
  const job = await startStudioImage({
    projectId: input.projectId,
    workspaceId: authorized.turn.workspaceId,
    userId: actingMemberOf(authorized),
    sessionId: null,
    // A styled picture is made the way a month's pictures are: the same
    // prompt, the reference first, the first of the style models.
    prompt:
      style && cuso
        ? cmoStylePrompt({
            piece: {
              visual: input.prompt,
              title: input.prompt,
              headline: style.headline ?? undefined,
            },
            slot: 0,
            businessName: cuso.businessName,
            colours: brand?.colours ?? [],
            brandPictures: referenceFileIds.length,
            traits: await readStyleTraits(style.referenceId),
            logo: Boolean(brand?.logoFileId),
          })
        : input.prompt,
    modelId: model.id,
    settings,
    referenceAssetIds: [],
    // A styled picture's second image is the brand's logo, drawn in.
    referenceFileIds: brand?.logoFileId
      ? [brand.logoFileId, ...referenceFileIds]
      : referenceFileIds,
    referenceLibraryIds: style ? [style.referenceId] : [],
    parentAssetId: null,
    idempotencyKey: `soko-bot:${authorized.turn.id}:${toolCallId}`,
  });
  const uncertain =
    "The provider did not confirm this request. Do not start it again; tell the owner.";
  if (style)
    return {
      jobId: job.id,
      projectId: input.projectId,
      status: job.status,
      model: model.id,
      credits,
      note:
        job.status === "SUBMISSION_UNCERTAIN"
          ? uncertain
          : "Started in the look of that reference. Core checks the picture against it and places the brand's logo; one the check turns down is made again, at most four tries. It takes a minute or two: wait_for its jobId, then get_image.",
    };
  return {
    jobId: job.id,
    projectId: input.projectId,
    status: job.status,
    model: model.id,
    credits,
    studioUrl: studioLink(input.projectId),
    ...(projectTarget.resolvedTarget
      ? { resolvedTarget: projectTarget.resolvedTarget }
      : {}),
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? uncertain
        : "Started. An image takes about a minute; check it with get_image.",
  };
}

/** Starts a studio image; a refusal before sending is the model's to read. */
async function startStudioImage(input: Parameters<typeof createImageJob>[0]) {
  try {
    return await createImageJob(input);
  } catch (error) {
    // The studio's refusals (no balance, too many at once) come before it
    // sends anything.
    if (error instanceof HTTPException)
      throw new SokoBotImageRefusedError(error.message);
    throw error;
  }
}

/** A chat job's key: its turn, its tool call and, after a refused try, the try. */
const CHAT_JOB_KEY = /^soko-bot:([0-9a-f-]{36}):(.+?)(?::style:(\d))?$/;

/**
 * Where a styled picture Cuso started in chat stands, once its job ended:
 * checked and with the logo in Files, or made again on the next style model
 * when the check turned it down or the model failed. Null for any other job.
 */
async function styledChatPicture(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  job: { id: string; status: string; assetId: string | null },
) {
  const row = await prisma.projectImageJob.findUnique({
    where: { id: job.id },
    select: {
      projectId: true,
      idempotencyKey: true,
      referenceLibraryIds: true,
      referenceFileIds: true,
      prompt: true,
      error: true,
    },
  });
  const referenceId = row?.referenceLibraryIds[0];
  const key = CHAT_JOB_KEY.exec(row?.idempotencyKey ?? "");
  if (!row || !referenceId || !key) return null;
  if (job.status !== "SUCCEEDED" && job.status !== "FAILED") return null;
  const [, turnId, toolCallId, tried] = key;
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  if (!cuso || !turnId || !toolCallId) return null;
  const call = await prisma.sokoBotToolCall.findFirst({
    where: { turnId, toolCallId },
    select: { input: true },
  });
  const asked = generateImageInputSchema.safeParse(call?.input);
  const drive = await runtime.ownerDrive(authorized);
  let problems = "the model could not make it";
  if (job.status === "SUCCEEDED" && job.assetId) {
    const finished = await finishCmoChatPicture({
      cuso,
      drive: {
        workspaceId: drive.key.workspaceId,
        organizationId:
          drive.key.scope === "organization" ? drive.key.ownerId : null,
        userId: drive.actor.userId,
      },
      job: { ...row, id: job.id, assetId: job.assetId },
      styleReferenceId: referenceId,
      headline: asked.success ? (asked.data.headline ?? null) : null,
      scene: asked.success ? asked.data.prompt : null,
    });
    if (finished.passed)
      return {
        jobId: job.id,
        status: job.status,
        failureReason: null,
        file: finished.file,
        note: "Made in the reference's look, checked, with the brand's logo. Put this fileId on the post as its media.",
      };
    problems = finished.problems;
  }
  const attempt = Number(tried ?? 1);
  const nextModel = REFERENCE_STYLE_MODELS[attempt];
  if (!nextModel)
    return {
      jobId: job.id,
      status: "FAILED",
      failureReason: null,
      note: `No model made a picture that passed the check (${problems}). Tell the owner, or start again with another reference from find_style_references or a shorter headline.`,
    };
  const next = await startStudioImage({
    projectId: row.projectId,
    workspaceId: authorized.turn.workspaceId,
    userId: actingMemberOf(authorized),
    sessionId: null,
    prompt: row.prompt,
    modelId: nextModel,
    settings: {
      ...DEFAULT_SETTINGS,
      outputFormat: "jpeg",
      ...(asked.success && asked.data.aspectRatio
        ? { aspectRatio: asked.data.aspectRatio }
        : {}),
    },
    referenceAssetIds: [],
    referenceFileIds: row.referenceFileIds,
    referenceLibraryIds: [referenceId],
    parentAssetId: null,
    idempotencyKey: `soko-bot:${turnId}:${toolCallId}:style:${attempt + 1}`,
  });
  return {
    jobId: next.id,
    status: next.status,
    failureReason: null,
    replaces: job.id,
    note: `The picture did not pass (${problems}), so it is being made again. Do not use the old one: wait_for jobId ${next.id}, then get_image with it.`,
  };
}

/** Starts a video in a Project's Content Studio, once checked. */
export async function generateVideo(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const projectTarget = await resolveProjectTargetForWrite(authorized, {
    projectId: rawProjectId(raw),
    mode: "studio_media",
    capability: "generate_video",
  });
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
    ...(projectTarget.resolvedTarget
      ? { resolvedTarget: projectTarget.resolvedTarget }
      : {}),
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? "The provider did not confirm this request. Do not start it again; tell the owner."
        : "Started. A video takes a few minutes; check it with get_video.",
  };
}

/** Starts a talking video in a Project's Content Studio, once checked. */
export async function generateTalkingVideo(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const projectTarget = await resolveProjectTargetForWrite(authorized, {
    projectId: rawProjectId(raw),
    mode: "studio_media",
    capability: "generate_talking_video",
  });
  const { input, model, credits } = await runtime
    .checkTalkingVideoRequest(authorized, raw, toolCallId)
    .catch((error: unknown) => {
      throw new SokoBotImageRefusedError(
        error instanceof Error ? error.message : "Talking video refused",
      );
    });
  const userId = actingMemberOf(authorized);
  const presenter = await talkingVideoPresenter({
    projectId: input.projectId,
    presenter: input.presenter,
    userId,
  });
  if (!presenter)
    throw new SokoBotImageRefusedError(
      "This Project has no owner photo with consent. Pick a stock presenter.",
    );
  let job: Awaited<ReturnType<typeof createTalkingVideoJob>>;
  try {
    job = await createTalkingVideoJob({
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId,
      modelId: model.id,
      script: input.script,
      voice: input.voice ?? DEFAULT_TALKING_VIDEO_VOICE,
      languageCode: input.languageCode ?? "en",
      presenter,
      broll: input.broll,
      music: input.music,
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
    studioUrl: studioLink(input.projectId),
    ...(projectTarget.resolvedTarget
      ? { resolvedTarget: projectTarget.resolvedTarget }
      : {}),
    note:
      job.status === "SUBMISSION_UNCERTAIN"
        ? "The provider did not confirm this request. Do not start it again; tell the owner."
        : job.status === "FAILED"
          ? "The video could not be started and nothing was charged; get_video says why."
          : "Started. A talking video takes a few minutes; call wait_for with its jobId, then get_video.",
  };
}

const STUDIO_JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an image or video started with `generate_image` or `generate_video` has got to. */
export async function getStudioJob(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
) {
  const input = getImageInputSchema.parse(raw);
  if (!STUDIO_JOB_ID.test(input.jobId)) {
    throw new SokoBotRuntimeValidationError(
      `"${input.jobId.slice(0, 80)}" is not a Content Studio job id. get_image and get_video only check jobs started with generate_image, generate_video or generate_talking_video, by the jobId they returned. A YouTube or other web video is not a studio job: read its page with web_fetch on the full link, or use a video file the owner uploaded (list_files).`,
    );
  }
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
    // Image Studio is Mainnet only, whatever the turn's Network.
    await reconcileProjectJobs(createNetworkScope("mainnet"), input.projectId);
    const job = await getJob({ ...scope, jobId: input.jobId });
    if (!job) return null;
    const styled = await styledChatPicture(runtime, authorized, job);
    if (styled) return styled;
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
            // A tool call in a background turn: its own event.
            const log = createCoreLogger({
              operation: "soko_bot_studio_job",
              imageJob: { id: job.id },
              turn: { id: authorized.turn.id },
            });
            logCoreWarning(
              log,
              {
                message: "Could not copy a studio image into Files",
                why: "The Files copy failed",
                fix: "The image stays in the studio and the bot is told there is no Files copy; asking for the job again retries the copy.",
              },
              // Only safe fields: turn work can echo its prompt.
              { failure: messageSafeErrorFields(error) },
            );
            log.emit();
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
