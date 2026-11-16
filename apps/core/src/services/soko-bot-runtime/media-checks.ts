import {
  CMO_PRODUCTION_MEDIA_PER_RUN,
  CMO_PRODUCTION_TURN_PREFIX,
  sokoBotGenerateImageInputSchema as generateImageInputSchema,
  sokoBotGenerateVideoInputSchema as generateVideoInputSchema,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { resolveImageSettings } from "@/lib/image-studio/catalog";
import { ensureImageCatalogFresh } from "@/lib/image-studio/fal-catalog-refresh";
import {
  creditsPerImage,
  IMAGE_ASPECT_RATIOS,
} from "@/lib/image-studio/image-model";
import { videoModel } from "@/lib/image-studio/video-catalog";
import {
  creditsPerVideo,
  DEFAULT_ANIMATE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  defaultVideoSettings,
  HIGH_QUALITY_ANIMATE_MODEL_ID,
  HIGH_QUALITY_VIDEO_MODEL_ID,
  type VideoModel,
  type VideoSettings,
  validateVideoSettings,
} from "@/lib/image-studio/video-model";
import { sokoBotProjectRefusal } from "@/lib/soko-bot/write-scope";
import { getJob } from "@/services/image-studio-assets.service";
import {
  DEFAULT_SETTINGS,
  type ImageJobSettings,
} from "@/services/image-studio-jobs.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { MAX_IMAGES_PER_TURN, MAX_VIDEOS_PER_TURN } from "./execution-limits";
import { botImageModel } from "./media-models";
import { type RuntimeOperations } from "./operations";

/**
 * Images and videos one turn may start. Cuso's production run makes a
 * whole month at once; four images a turn left it 33 short.
 */
export async function mediaPerTurn(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
): Promise<{ images: number; videos: number }> {
  const chat = { images: MAX_IMAGES_PER_TURN, videos: MAX_VIDEOS_PER_TURN };
  if (authorized.turn.source !== "EVENT") return chat;
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { clientTurnId: true },
  });
  return turn?.clientTurnId.startsWith(CMO_PRODUCTION_TURN_PREFIX)
    ? CMO_PRODUCTION_MEDIA_PER_RUN
    : chat;
}

/**
 * The Project whose Social comments a bot handles: its own, as a Project
 * bot such as Cuso. A Brand Brain, when the bot has one, informs the reply
 * check.
 */
export async function socialCommentScopeOf(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
) {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: authorized.turn.sokoBotId },
    select: {
      projectId: true,
      project: { select: { brandBrain: { select: { body: true } } } },
    },
  });
  if (!bot?.projectId)
    throw new SokoBotRuntimeValidationError(
      "Social comments belong to a Project, and this bot has none.",
    );
  return {
    projectId: bot.projectId,
    brandBrain: bot.project?.brandBrain?.body ?? null,
  };
}

export async function checkImageRequest(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const input = generateImageInputSchema.parse(raw);
  if (!(await runtime.mayActForOwner(authorized)))
    throw new SokoBotRuntimeAuthorizationError(
      "Images are generated only when a person asks in chat. Describe the image you would make instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const started = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: "generate_image",
      OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
      NOT: { toolCallId },
    },
  });
  const { images } = await runtime.mediaPerTurn(authorized);
  if (started >= images)
    throw new SokoBotRuntimeValidationError(
      `One turn may start at most ${images} images. Show your owner these first.`,
    );
  const aspectRatio = z
    .enum(IMAGE_ASPECT_RATIOS)
    .optional()
    .safeParse(input.aspectRatio);
  if (!aspectRatio.success)
    throw new SokoBotRuntimeValidationError(
      `Use one of these aspect ratios: ${IMAGE_ASPECT_RATIOS.join(", ")}.`,
    );
  runtime.requireImageProject(authorized, input.projectId);
  try {
    await requireProjectAccess({
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
    });
  } catch (error) {
    if (error instanceof HTTPException)
      throw new SokoBotRuntimeValidationError(
        "That Project is not one your owner can open.",
      );
    throw error;
  }
  const referenceFileIds = await runtime.imageReferenceFiles(
    authorized,
    input.referenceFileIds ?? [],
  );
  await ensureImageCatalogFresh();
  const model = botImageModel(input.model);
  const settings: ImageJobSettings = {
    ...DEFAULT_SETTINGS,
    // Every network takes a JPEG; Instagram takes nothing else.
    ...(model.outputFormats.includes("jpeg") ? { outputFormat: "jpeg" } : {}),
    ...(aspectRatio.data ? { aspectRatio: aspectRatio.data } : {}),
  };
  let credits: number;
  try {
    credits = creditsPerImage(
      model,
      resolveImageSettings(model.id, settings, referenceFileIds.length),
    );
  } catch (error) {
    throw new SokoBotRuntimeValidationError(
      error instanceof Error ? error.message : "Invalid image settings",
    );
  }
  if (credits > input.maxCredits)
    throw new SokoBotRuntimeValidationError(
      `This image costs ${credits} credits, more than the ${input.maxCredits} allowed. Ask your owner before spending more.`,
    );
  return { input, model, settings, credits, referenceFileIds };
}

/**
 * Everything that can refuse a video before anything is sent, mirroring
 * {@link checkImageRequest}: an owner chat turn, a Project the owner can
 * open, a finished image to animate when one is named, and a price within
 * maxCredits.
 */
export async function checkVideoRequest(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const input = generateVideoInputSchema.parse(raw);
  if (!(await runtime.mayActForOwner(authorized)))
    throw new SokoBotRuntimeAuthorizationError(
      "Videos are generated only when a person asks in chat. Describe the video you would make instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const started = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: "generate_video",
      OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
      NOT: { toolCallId },
    },
  });
  const { videos } = await runtime.mediaPerTurn(authorized);
  if (started >= videos)
    throw new SokoBotRuntimeValidationError(
      `One turn may start at most ${videos} videos. Show your owner these first.`,
    );
  runtime.requireImageProject(authorized, input.projectId);
  const scope = {
    projectId: input.projectId,
    workspaceId: authorized.turn.workspaceId,
    userId: actingMemberOf(authorized),
  };
  try {
    await requireProjectAccess(scope);
  } catch (error) {
    if (error instanceof HTTPException)
      throw new SokoBotRuntimeValidationError(
        "That Project is not one your owner can open.",
      );
    throw error;
  }

  let sourceAssetId: string | null = null;
  if (input.imageJobId) {
    const source = await getJob({ ...scope, jobId: input.imageJobId });
    if (!source || source.video !== null)
      throw new SokoBotRuntimeValidationError(
        "imageJobId must be a generate_image job in this Project.",
      );
    if (!source.assetId)
      throw new SokoBotRuntimeValidationError(
        "That image is not ready yet. Check it with get_image first.",
      );
    sourceAssetId = source.assetId;
  }

  await ensureImageCatalogFresh();
  const animate = sourceAssetId !== null;
  const high = input.quality === "high";
  let model: VideoModel;
  let settings: VideoSettings;
  let credits: number;
  try {
    model = videoModel(
      animate
        ? high
          ? HIGH_QUALITY_ANIMATE_MODEL_ID
          : DEFAULT_ANIMATE_MODEL_ID
        : high
          ? HIGH_QUALITY_VIDEO_MODEL_ID
          : DEFAULT_VIDEO_MODEL_ID,
    );
    settings = validateVideoSettings(
      model,
      {
        ...defaultVideoSettings(model),
        ...(input.aspectRatio && !animate
          ? { aspectRatio: input.aspectRatio }
          : {}),
        ...(input.durationSeconds
          ? { durationSeconds: input.durationSeconds }
          : {}),
      },
      animate,
    );
    credits = creditsPerVideo(model, settings);
  } catch (error) {
    throw new SokoBotRuntimeValidationError(
      error instanceof Error ? error.message : "Invalid video settings",
    );
  }
  if (credits > input.maxCredits)
    throw new SokoBotRuntimeValidationError(
      `This video costs ${credits} credits, more than the ${input.maxCredits} allowed. Ask your owner before spending more.`,
    );
  return { input, model, settings, credits, sourceAssetId };
}

/**
 * Cuso's own runs describe each piece's visual and Core makes the media:
 * runs that started their own made 25 files for 14 pieces, three at a time
 * against the studio's limit, and put one picture on three posts.
 */
export function refuseCmoRunMedia(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
): void {
  const { turn } = authorized;
  if (
    turn.source !== "CHAT" &&
    getSokoBotVersion(turn.versionId).profile === "cmo"
  )
    throw new SokoBotRuntimeValidationError(
      "Core makes the month's pictures and videos. Save the piece's visual (what it shows) and visualFileIds with save_strategy part pieces instead.",
    );
}

/** A project bot makes and reads images in its own Project only. */
export function requireImageProject(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  projectId: string,
) {
  const scope = authorized.reader.sharedScope;
  const refusal = sokoBotProjectRefusal(scope, [projectId]);
  if (refusal) throw new SokoBotRuntimeValidationError(refusal);
}
