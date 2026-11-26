import {
  CMO_PRODUCTION_MEDIA_PER_RUN,
  CMO_PRODUCTION_TURN_PREFIX,
  sokoBotGenerateImageInputSchema as generateImageInputSchema,
  sokoBotGenerateTalkingVideoInputSchema as generateTalkingVideoInputSchema,
  sokoBotGenerateVideoInputSchema as generateVideoInputSchema,
  getSokoBotVersion,
  sokoBotFollowUpAllowsSchema,
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
import {
  creditsPerTalkingVideo,
  findTalkingVideoPresenter,
  posesAsCustomerTestimonial,
  TALKING_VIDEO_TESTIMONIAL_MESSAGE,
  talkingVideoModel,
} from "@/lib/image-studio/talking-video";
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
import { FOLLOW_UP_RETRY_SUFFIX } from "@/lib/soko-bot/follow-up-retry";
import { isOwnerRequest } from "@/lib/soko-bot/owner-request";
import { sokoBotProjectRefusal } from "@/lib/soko-bot/write-scope";
import {
  MAX_STYLE_BRAND_PICTURES,
  REFERENCE_STYLE_MODELS,
} from "@/services/cmo-media-maker.service";
import { getJob } from "@/services/image-studio-assets.service";
import {
  DEFAULT_SETTINGS,
  type ImageJobSettings,
  talkingVideoShowsSite,
} from "@/services/image-studio-jobs.service";
import { referenceLibraryAvailable } from "@/services/reference-library.service";
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

/**
 * A person asked in chat, or this turn carries out a follow-up the owner
 * asked for: "have a Coworker research this, then make images and a post"
 * reaches the images on the turn Core starts when the research is back.
 */
export async function mayMakeMediaForOwner(
  runtime: Pick<RuntimeOperations, "mayActForOwner">,
  authorized: AuthorizedSokoBotRuntime,
): Promise<MediaAllowance | null> {
  if (await runtime.mayActForOwner(authorized)) return {};
  if (authorized.turn.source !== "EVENT") return null;
  const owner = {
    source: true,
    chainDepth: true,
    askedByUserId: true,
    requestedByUserId: true,
  } as const;
  const carried = await prisma.sokoBotDelegation.findMany({
    where: { followUpTurnId: authorized.turn.id, followUp: { not: null } },
    select: {
      followUpAllows: true,
      turn: {
        select: {
          ...owner,
          parentTurnId: true,
          parentTurn: { select: owner },
        },
      },
    },
  });
  const asked = carried.filter((delegation) =>
    isOwnerRequest(delegation.turn, { schedules: true }),
  );
  if (!asked.length) return null;
  // A limit holds only when every plan this turn carries out gave one.
  const allows = asked.map(
    (delegation) =>
      sokoBotFollowUpAllowsSchema.safeParse(delegation.followUpAllows).data,
  );
  // The limits the owner gave hold, summed; a plan without media limits
  // ("give the findings to Alex") in the same wake does not lift them.
  const total = (key: "images" | "maxCredits") => {
    const given = allows.flatMap((allow) =>
      allow?.[key] !== undefined ? [allow[key]] : [],
    );
    return given.length
      ? given.reduce((sum, value) => sum + value, 0)
      : undefined;
  };
  return {
    images: total("images"),
    maxCredits: total("maxCredits"),
    planTurnIds: await planTurnIds(authorized),
  };
}

/**
 * This turn and the turns the same plans were handed to before it: a
 * follow-up's retry continues the failed turn's images, it does not start
 * the owner's allowance again.
 */
async function planTurnIds(
  authorized: AuthorizedSokoBotRuntime,
): Promise<string[]> {
  const retried = (
    await prisma.sokoBotEventInbox.findMany({
      where: { turnId: authorized.turn.id },
      select: { eventId: true, entityId: true },
    })
  ).filter((entry) => entry.eventId.endsWith(FOLLOW_UP_RETRY_SUFFIX));
  if (!retried.length) return [authorized.turn.id];
  // The failed wakes on the same Task or Job: the retry's occurrence can be
  // a later event than the failed turn's, when that turn wrote one itself.
  const earlier = await prisma.sokoBotEventInbox.findMany({
    where: {
      botId: authorized.turn.sokoBotId,
      entityId: { in: [...new Set(retried.map((entry) => entry.entityId))] },
      turn: { status: "FAILED" },
    },
    select: { turnId: true },
  });
  return [
    ...new Set([authorized.turn.id, ...earlier.map((entry) => entry.turnId)]),
  ];
}

/** What the owner allowed media on this turn; empty means the turn's own caps. */
export interface MediaAllowance {
  images?: number;
  maxCredits?: number;
  /** The turns the allowance is spent across; this turn alone when unset. */
  planTurnIds?: string[];
}

/**
 * Refuses media past the credits the owner allowed for the plan this turn
 * carries out: what earlier images and videos of the turn may cost, plus
 * this one.
 */
async function refuseOverAllowance(
  allowance: MediaAllowance,
  authorized: AuthorizedSokoBotRuntime,
  toolCallId: string,
  maxCredits: number,
): Promise<void> {
  if (allowance.maxCredits === undefined) return;
  const earlier = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: allowance.planTurnIds ?? [authorized.turn.id] },
      capability: { in: ["generate_image", "generate_video"] },
      OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
      // Only this call: another turn's call can carry the same id.
      NOT: { turnId: authorized.turn.id, toolCallId },
    },
    select: { input: true },
  });
  const spent = earlier.reduce(
    (sum, call) =>
      sum +
      (z.object({ maxCredits: z.number() }).safeParse(call.input).data
        ?.maxCredits ?? 0),
    0,
  );
  if (spent + maxCredits > allowance.maxCredits)
    throw new SokoBotRuntimeValidationError(
      `The owner allowed ${allowance.maxCredits} credits on media for this plan, and ${spent} are set aside already. Make it fit with a lower maxCredits, or tell the owner what more would cost.`,
    );
}

export async function checkImageRequest(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const input = generateImageInputSchema.parse(raw);
  const allowance = await mayMakeMediaForOwner(runtime, authorized);
  if (!allowance)
    throw new SokoBotRuntimeAuthorizationError(
      "Images are generated only when a person asks in chat. Describe the image you would make instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const startedOn = (turnIds: string[]) =>
    prisma.sokoBotToolCall.count({
      where: {
        turnId: { in: turnIds },
        capability: "generate_image",
        OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
        NOT: { turnId: authorized.turn.id, toolCallId },
      },
    });
  const perTurn = (await runtime.mediaPerTurn(authorized)).images;
  if ((await startedOn([authorized.turn.id])) >= perTurn)
    throw new SokoBotRuntimeValidationError(
      `One turn may start at most ${perTurn} images. Show your owner these first.`,
    );
  // The owner's count holds across the plan's turns, a retry included.
  if (
    allowance.images !== undefined &&
    (await startedOn(allowance.planTurnIds ?? [authorized.turn.id])) >=
      allowance.images
  )
    throw new SokoBotRuntimeValidationError(
      `The owner asked for ${allowance.images} image${allowance.images > 1 ? "s" : ""} in this plan. Use those in the draft.`,
    );
  await refuseOverAllowance(
    allowance,
    authorized,
    toolCallId,
    input.maxCredits,
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
  const style = await cmoPictureStyle(authorized, input, referenceFileIds);
  const model = style
    ? botImageModel(REFERENCE_STYLE_MODELS[0])
    : botImageModel(input.model);
  const settings: ImageJobSettings = {
    ...DEFAULT_SETTINGS,
    // Every network takes a JPEG; Instagram takes nothing else.
    ...(model.outputFormats.includes("jpeg") ? { outputFormat: "jpeg" } : {}),
    ...(aspectRatio.data ? { aspectRatio: aspectRatio.data } : {}),
  };
  // A styled picture sends its reference before the brand's own pictures.
  const references = referenceFileIds.length + (style ? 1 : 0);
  let credits: number;
  // A picture the style check turns down is made again on a dearer model
  // without another question, so the allowance has to cover that try too.
  let dearestTry: number;
  try {
    credits = creditsPerImage(
      model,
      resolveImageSettings(model.id, settings, references),
    );
    dearestTry = style
      ? Math.max(
          ...REFERENCE_STYLE_MODELS.map((id) =>
            creditsPerImage(
              botImageModel(id),
              resolveImageSettings(id, settings, references),
            ),
          ),
        )
      : credits;
  } catch (error) {
    throw new SokoBotRuntimeValidationError(
      error instanceof Error ? error.message : "Invalid image settings",
    );
  }
  if (dearestTry > input.maxCredits)
    throw new SokoBotRuntimeValidationError(
      style
        ? // The owner asked for the picture, and a month's pictures cost the same.
          `A picture in a library style costs ${credits} credits, and up to ${dearestTry} when a stronger model has to make it again, more than the ${input.maxCredits} allowed. Call generate_image again with maxCredits ${Math.ceil(dearestTry)}.`
        : `This image costs ${credits} credits, more than the ${input.maxCredits} allowed. Ask your owner before spending more.`,
    );
  return { input, model, settings, credits, referenceFileIds, style };
}

/**
 * The reference library style of a picture Cuso makes in chat. A picture
 * for a post or an ad goes the way a month's pictures do: in the look of a
 * reference, checked, with the brand's logo; the brand's own page, screen or
 * product (referenceFileIds) is set inside the style. Cuso leaves the style
 * out only for a model the owner named.
 * No other bot has styles, and nothing changes where there is no library.
 */
async function cmoPictureStyle(
  authorized: AuthorizedSokoBotRuntime,
  input: z.infer<typeof generateImageInputSchema>,
  referenceFileIds: readonly string[],
): Promise<{ referenceId: string; headline: string | null } | null> {
  const cuso = getSokoBotVersion(authorized.turn.versionId).profile === "cmo";
  if (!input.styleReferenceId) {
    if (input.headline)
      throw new SokoBotRuntimeValidationError(
        "headline belongs to a styled picture: pass styleReferenceId with it, or leave it out.",
      );
    if (cuso && referenceLibraryAvailable() && !input.model)
      throw new SokoBotRuntimeValidationError(
        "A picture for a post or an ad takes the look of an old print. Call find_style_references with what the picture is about, then generate_image again with styleReferenceId (an id it returned) and, when the picture should carry words, headline (at most six). When the picture shows the brand's real page, screen, product or the owner's photo, keep that picture in referenceFileIds: Core sets it inside the style. Only when the owner asked for a plain picture or named a model pass model.",
      );
    return null;
  }
  if (!cuso)
    throw new SokoBotRuntimeValidationError(
      "Leave styleReferenceId and headline out: only Cuso makes pictures in a library style.",
    );
  if (!referenceLibraryAvailable())
    throw new SokoBotRuntimeValidationError(
      "The reference library is not set up here: leave styleReferenceId and headline out.",
    );
  if (input.model)
    throw new SokoBotRuntimeValidationError(
      "A styled picture takes no model: Core picks it. Leave model out, or leave styleReferenceId out.",
    );
  if (referenceFileIds.length > MAX_STYLE_BRAND_PICTURES)
    throw new SokoBotRuntimeValidationError(
      `A styled picture shows at most ${MAX_STYLE_BRAND_PICTURES} of the brand's own pictures: pass only the page, screen or product it must show.`,
    );
  const reference = await prisma.referenceImage.findUnique({
    where: { id: input.styleReferenceId },
    select: { id: true },
  });
  if (!reference)
    throw new SokoBotRuntimeValidationError(
      "No such style reference: use an id find_style_references returned.",
    );
  return { referenceId: reference.id, headline: input.headline ?? null };
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
  const allowance = await mayMakeMediaForOwner(runtime, authorized);
  if (!allowance)
    throw new SokoBotRuntimeAuthorizationError(
      "Videos are generated only when a person asks in chat. Describe the video you would make instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  await refuseOverAllowance(
    allowance,
    authorized,
    toolCallId,
    input.maxCredits,
  );
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
 * Everything that can refuse a talking video before anything is sent: an
 * owner chat turn, a Project the owner can open, a known presenter, a script
 * in the brand's voice and a price within maxCredits. It counts against the
 * same per-turn allowance as other videos.
 */
export async function checkTalkingVideoRequest(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
) {
  const input = generateTalkingVideoInputSchema.parse(raw);
  if (!(await runtime.mayActForOwner(authorized)))
    throw new SokoBotRuntimeAuthorizationError(
      "Talking videos are made only when a person asks in chat. Write the script you would use instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const started = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: { in: ["generate_video", "generate_talking_video"] },
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
  if (
    input.presenter !== "owner" &&
    !findTalkingVideoPresenter(input.presenter)
  )
    throw new SokoBotRuntimeValidationError(
      "presenter must be owner (when the owner gave a photo) or one of maya, jonas, aisha, leo, elena, david, mei or omar.",
    );
  if (posesAsCustomerTestimonial(input.script))
    throw new SokoBotRuntimeValidationError(TALKING_VIDEO_TESTIMONIAL_MESSAGE);
  const model = talkingVideoModel();
  const extras = {
    siteShots: await talkingVideoShowsSite(input.projectId),
    broll: input.broll === true,
    music: input.music === true,
  };
  const credits = creditsPerTalkingVideo(model, input.script, extras);
  if (credits > input.maxCredits) {
    let fits = input.script.length;
    while (
      fits > 0 &&
      creditsPerTalkingVideo(model, "x".repeat(fits), extras) > input.maxCredits
    )
      fits--;
    throw new SokoBotRuntimeValidationError(
      `This video costs ${credits} credits, more than the ${input.maxCredits} allowed. ${fits >= 20 ? `A script of at most ${fits} characters fits; shorten it, or ask` : "Ask"} your owner before spending more.`,
    );
  }
  return { input, model, credits };
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
