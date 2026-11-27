import {
  CMO_PRODUCTION_MEDIA_PER_RUN,
  CMO_PRODUCTION_TURN_PREFIX,
  sokoBotGenerateImageInputSchema as generateImageInputSchema,
  sokoBotGenerateTalkingVideoInputSchema as generateTalkingVideoInputSchema,
  sokoBotGenerateVideoInputSchema as generateVideoInputSchema,
  getSokoBotVersion,
  type OwnerAuthority,
  parseOwnerAuthority,
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
import {
  checkGrantSpendPreflight,
  type MediaSpendGrant,
  type MediaSpendRequest,
  summarizeGrantBuckets,
} from "@/lib/soko-bot/authority-spend";
import { FOLLOW_UP_RETRY_SUFFIX } from "@/lib/soko-bot/follow-up-retry";
import {
  intersectOwnerAuthority,
  isAuthorityRevokedInSources,
  isWatchClientTurnId,
  loadRevokedAuthoritySources,
  type OwnerAuthorityAskedByKind,
  resolveDelegationWakeAuthority,
  resolveSocialWriteOrigin,
  SCHEDULE_AUTHORITY_INVALID_MESSAGE,
  WATCH_AUTHORITY_INVALID_MESSAGE,
  WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
} from "@/lib/soko-bot/owner-authority";
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

function wakeAskedByKind(
  authorized: AuthorizedSokoBotRuntime,
): OwnerAuthorityAskedByKind {
  if (
    authorized.askedByKind === "OWNER" ||
    authorized.askedByKind === "TEAMMATE" ||
    authorized.askedByKind === "ASSISTANT"
  ) {
    return authorized.askedByKind;
  }
  return (authorized.turn.chainDepth ?? 0) > 0 ? "ASSISTANT" : "OWNER";
}

type MediaCapability =
  | "generate_image"
  | "generate_video"
  | "generate_talking_video";

function explicitLimitsAllowMediaCapability(
  limits: NonNullable<OwnerAuthority["limits"]>,
  capability: MediaCapability,
): boolean {
  const hasAnyCap =
    limits.images !== undefined ||
    limits.videos !== undefined ||
    limits.maxMediaCredits !== undefined;
  if (!hasAnyCap) return false;
  if (capability === "generate_image") {
    return (
      limits.images !== undefined ||
      (limits.videos === undefined && limits.maxMediaCredits !== undefined)
    );
  }
  return (
    limits.videos !== undefined ||
    (limits.images === undefined && limits.maxMediaCredits !== undefined)
  );
}

function summarizeSingleAuthorityMediaAllowance(
  authority: OwnerAuthority,
  grantIdOverride?: string,
): MediaAllowance {
  const effectiveAuthority =
    grantIdOverride && authority.limits
      ? {
          ...authority,
          grantId: grantIdOverride,
          limits: { ...authority.limits, grantId: grantIdOverride },
        }
      : authority;
  const summarized = summarizeGrantBuckets([{ authority: effectiveAuthority }]);
  if (summarized.unboundedPerTurn) {
    return {};
  }
  const total = (key: "images" | "maxMediaCredits") => {
    const given = summarized.grants.flatMap((grant) =>
      grant[key] !== undefined ? [grant[key]] : [],
    );
    return given.length
      ? given.reduce((sum, value) => sum + value, 0)
      : undefined;
  };
  return {
    images: total("images"),
    maxCredits: total("maxMediaCredits"),
    grants: summarized.grants,
    unboundedPerTurn: false,
  };
}

/**
 * A person asked in chat, or this turn carries out a follow-up the owner
 * asked for: "have a Coworker research this, then make images and a post"
 * reaches the images on the turn Core starts when the research is back.
 *
 * Evaluates persisted `OwnerAuthority` for watch wakes, scheduled runs (with
 * explicit `per_occurrence` or `lifetime` media limits), `ADMIN_RETRY` replays,
 * and delegation `EVENT` wakes (falling back deterministically for pre-migration
 * rows where `authority === null`), intersects with live binding/actor/expiry/
 * Project scope, and enforces shared durable `grantId` balances.
 */
export async function mayMakeMediaForOwner(
  runtime: Pick<RuntimeOperations, "mayActForOwner">,
  authorized: AuthorizedSokoBotRuntime,
  options?: { projectId?: string; capability?: MediaCapability },
): Promise<MediaAllowance | null> {
  const capability: MediaCapability = options?.capability ?? "generate_image";
  const isWatchOrScheduledOrRetry =
    isWatchClientTurnId(authorized.turn.clientTurnId) ||
    authorized.turn.source === "SCHEDULE" ||
    authorized.turn.source === "ADMIN_RETRY";

  if (isWatchOrScheduledOrRetry) {
    const origin = await resolveSocialWriteOrigin(authorized.turn, prisma);
    const now = new Date();
    const askedByKind = wakeAskedByKind(authorized);
    const sharedBot = Boolean(authorized.reader?.sharedScope);

    if (origin.watchAuthority && origin.watchAuthority.kind !== "none") {
      if (origin.watchAuthority.kind === "unresolved") {
        throw new SokoBotRuntimeAuthorizationError(
          WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
        );
      }
      const persisted = parseOwnerAuthority(origin.watchAuthority.authority);
      if (!persisted) {
        throw new SokoBotRuntimeAuthorizationError(
          WATCH_AUTHORITY_INVALID_MESSAGE,
        );
      }
      const liveProjectId =
        options?.projectId ??
        origin.watchAuthority.watchProjectId ??
        authorized.turn.botProjectId ??
        origin.watchAuthority.botProjectId ??
        null;
      const effective = intersectOwnerAuthority(persisted, {
        sokoBotId: authorized.turn.sokoBotId,
        workspaceId: authorized.turn.workspaceId,
        versionId: authorized.turn.versionId,
        actingUserId: authorized.turn.actingUserId,
        askedByKind,
        sharedBot,
        source: origin.source,
        ...(persisted.scheduleId ? { scheduleId: persisted.scheduleId } : {}),
        ...(liveProjectId
          ? {
              targetScope: {
                kind: "project" as const,
                projectId: liveProjectId,
              },
            }
          : {}),
        hasWorkspaceAccess: true,
        botAlive: true,
        ...(origin.watchAuthority.revoked ? { revoked: true } : {}),
        carriedUntrustedContent:
          origin.watchAuthority.watchKind === "chat_reply",
        offeredCapabilities: [capability],
        now,
      });
      if (!effective.effective) {
        if (effective.denialReason === "target_scope_mismatch") {
          throw new SokoBotRuntimeValidationError(
            "The owner's media authorization for this follow-up is scoped to a different Project.",
          );
        }
        if (effective.denialReason === "revoked") {
          throw new SokoBotRuntimeAuthorizationError(
            "The owner's media authorization for this follow-up was revoked. Ask the owner in chat to start it again.",
          );
        }
        if (effective.denialReason === "expired") {
          throw new SokoBotRuntimeAuthorizationError(
            "The owner's media authorization for this follow-up has expired. Ask the owner in chat to renew it.",
          );
        }
        return null;
      }
      if (
        effective.authority.origin === "system" ||
        effective.authority.scope === "read_only"
      ) {
        return null;
      }
      const limits = effective.authority.limits;
      if (limits && !explicitLimitsAllowMediaCapability(limits, capability)) {
        return null;
      }
      const hasExplicitMedia = limits !== undefined;
      const chatWatchAllowed =
        origin.source === "CHAT" &&
        (authorized.turn.source === "ADMIN_RETRY"
          ? authorized.turn.chainDepth === 0 &&
            authorized.askedByKind !== "ASSISTANT"
          : await runtime.mayActForOwner(authorized));
      const scheduleWatchAllowed =
        origin.source === "SCHEDULE" &&
        (hasExplicitMedia || (await runtime.mayActForOwner(authorized)));
      if (!chatWatchAllowed && !scheduleWatchAllowed) {
        return null;
      }
      return summarizeSingleAuthorityMediaAllowance(effective.authority);
    }

    if (
      origin.source === "SCHEDULE" &&
      origin.scheduleAuthority.kind !== "none"
    ) {
      if (origin.scheduleAuthority.kind === "unresolved") {
        return null;
      }
      const persisted = parseOwnerAuthority(origin.scheduleAuthority.authority);
      if (!persisted) {
        throw new SokoBotRuntimeAuthorizationError(
          SCHEDULE_AUTHORITY_INVALID_MESSAGE,
        );
      }
      const liveProjectId =
        options?.projectId ??
        authorized.turn.botProjectId ??
        origin.scheduleAuthority.botProjectId ??
        null;
      const effective = intersectOwnerAuthority(persisted, {
        sokoBotId: authorized.turn.sokoBotId,
        workspaceId: authorized.turn.workspaceId,
        versionId: authorized.turn.versionId,
        actingUserId: authorized.turn.actingUserId,
        askedByKind,
        sharedBot,
        source: "SCHEDULE",
        scheduleId: origin.scheduleAuthority.scheduleId,
        ...(liveProjectId
          ? {
              targetScope: {
                kind: "project" as const,
                projectId: liveProjectId,
              },
            }
          : {}),
        hasWorkspaceAccess: true,
        botAlive: true,
        ...(origin.scheduleAuthority.revoked ? { revoked: true } : {}),
        offeredCapabilities: [capability],
        now,
      });
      if (!effective.effective) {
        if (effective.denialReason === "target_scope_mismatch") {
          throw new SokoBotRuntimeValidationError(
            "The owner's media authorization for this schedule is scoped to a different Project.",
          );
        }
        if (effective.denialReason === "revoked") {
          throw new SokoBotRuntimeAuthorizationError(
            "The owner's media authorization for this schedule was revoked. Ask the owner in chat to re-enable or recreate it.",
          );
        }
        if (effective.denialReason === "expired") {
          throw new SokoBotRuntimeAuthorizationError(
            "The owner's media authorization for this schedule has expired. Ask the owner in chat to renew it.",
          );
        }
        return null;
      }
      if (
        effective.authority.origin === "system" ||
        effective.authority.scope === "read_only"
      ) {
        return null;
      }
      const limits = effective.authority.limits;
      if (limits) {
        if (!explicitLimitsAllowMediaCapability(limits, capability)) {
          return null;
        }
        const bucketGrantId =
          limits.period === "lifetime"
            ? limits.grantId
            : `${limits.grantId}:${origin.scheduleAuthority.occurrenceKey ?? `turn:${authorized.turn.id}`}`;
        return summarizeSingleAuthorityMediaAllowance(
          effective.authority,
          bucketGrantId,
        );
      }
      if (authorized.turn.source === "ADMIN_RETRY") {
        return null;
      }
      return (await runtime.mayActForOwner(authorized)) ? {} : null;
    }
  }

  if (await runtime.mayActForOwner(authorized)) return {};
  if (
    authorized.turn.source !== "EVENT" ||
    capability === "generate_talking_video"
  ) {
    return null;
  }
  const owner = {
    source: true,
    chainDepth: true,
    askedByUserId: true,
    requestedByUserId: true,
  } as const;
  const carried = await prisma.sokoBotDelegation.findMany({
    where: { followUpTurnId: authorized.turn.id, followUp: { not: null } },
    select: {
      id: true,
      authority: true,
      followUpAllows: true,
      turn: {
        select: {
          id: true,
          sokoBotId: true,
          workspaceId: true,
          versionId: true,
          ...owner,
          parentTurnId: true,
          parentTurn: { select: owner },
          sokoBot: { select: { userId: true, projectId: true } },
        },
      },
    },
  });
  if (!carried.length) return null;

  const now = new Date();
  const askedByKind = wakeAskedByKind(authorized);
  const fallbackSokoBotId = authorized.turn.sokoBotId ?? "unknown-bot";
  const fallbackWorkspaceId =
    authorized.turn.workspaceId ?? "unknown-workspace";
  const versionId = authorized.turn.versionId ?? null;
  const allLiveEffective: { authority: OwnerAuthority }[] = [];
  const matchedEffective: { authority: OwnerAuthority }[] = [];
  let sawRevoked = false;
  let sawExpired = false;
  let sawScopeMismatch = false;

  const resolvedDelegations = carried.map((delegation, index) => ({
    delegation,
    authority: resolveDelegationWakeAuthority(
      {
        id: delegation.id ?? `legacy-${index}`,
        authority: delegation.authority,
        followUpAllows: delegation.followUpAllows,
        turn: delegation.turn,
      },
      {
        sokoBotId: fallbackSokoBotId,
        workspaceId: fallbackWorkspaceId,
        versionId,
      },
    ),
  }));
  const revokedSources = await loadRevokedAuthoritySources(
    resolvedDelegations.map((item) => item.authority),
    prisma,
  );

  for (const { delegation, authority } of resolvedDelegations) {
    if (authority.origin === "system") continue;
    const sokoBotId = authorized.turn.sokoBotId ?? authority.sokoBotId;
    const workspaceId = authorized.turn.workspaceId ?? authority.workspaceId;
    const actingUserId =
      authorized.turn.actingUserId !== undefined
        ? authorized.turn.actingUserId
        : (delegation.turn.requestedByUserId ?? null);
    const sharedBot = delegation.turn.sokoBot?.userId === null;
    const botProjectId =
      authorized.turn.botProjectId ??
      delegation.turn.sokoBot?.projectId ??
      null;
    const revoked = isAuthorityRevokedInSources(authority, revokedSources);
    const baseContext = {
      sokoBotId,
      workspaceId,
      versionId,
      actingUserId,
      askedByKind,
      sharedBot,
      source: "EVENT",
      ...(authority.scheduleId ? { scheduleId: authority.scheduleId } : {}),
      hasWorkspaceAccess: true,
      botAlive: true,
      ...(revoked ? { revoked: true } : {}),
      offeredCapabilities: ["generate_image", "generate_video"] as const,
      now,
    };
    const liveBotScoped = intersectOwnerAuthority(authority, {
      ...baseContext,
      targetScope: botProjectId
        ? {
            kind: "project" as const,
            projectId: botProjectId,
          }
        : authority.targetScope,
    });
    if (!liveBotScoped.effective) {
      if (liveBotScoped.denialReason === "revoked") sawRevoked = true;
      if (liveBotScoped.denialReason === "expired") sawExpired = true;
      if (liveBotScoped.denialReason === "target_scope_mismatch") {
        sawScopeMismatch = true;
      }
      continue;
    }
    if (
      liveBotScoped.authority.origin === "system" ||
      liveBotScoped.authority.scope === "read_only"
    ) {
      continue;
    }
    allLiveEffective.push({ authority: liveBotScoped.authority });

    const requestedProjectId = options?.projectId ?? botProjectId;
    if (requestedProjectId) {
      const matched = intersectOwnerAuthority(liveBotScoped.authority, {
        ...baseContext,
        targetScope: {
          kind: "project" as const,
          projectId: requestedProjectId,
        },
      });
      if (!matched.effective) {
        if (matched.denialReason === "target_scope_mismatch") {
          sawScopeMismatch = true;
        }
        continue;
      }
      matchedEffective.push({ authority: matched.authority });
    } else {
      matchedEffective.push({ authority: liveBotScoped.authority });
    }
  }

  if (!matchedEffective.length) {
    if (sawScopeMismatch) {
      throw new SokoBotRuntimeValidationError(
        "The owner's media authorization for this follow-up is scoped to a different Project.",
      );
    }
    if (sawRevoked) {
      throw new SokoBotRuntimeAuthorizationError(
        "The owner's media authorization for this follow-up was revoked. Ask the owner in chat to start it again.",
      );
    }
    if (sawExpired) {
      throw new SokoBotRuntimeAuthorizationError(
        "The owner's media authorization for this follow-up has expired. Ask the owner in chat to renew it.",
      );
    }
    return null;
  }

  const turns = await planTurnIds(authorized);
  const matchedSummarized = summarizeGrantBuckets(
    matchedEffective.map((item) => ({
      authority: item.authority,
      legacyTurnIds: turns,
    })),
  );
  // Preserve sibling-project limited grants on the wake so historical legacy
  // spend for Project A is attributed to Project A's grant before evaluating
  // capacity on Project B's eligible grants.
  const allSummarized = matchedSummarized.unboundedPerTurn
    ? matchedSummarized
    : summarizeGrantBuckets(
        allLiveEffective.map((item) => ({
          authority: item.authority,
          legacyTurnIds: turns,
        })),
      );
  const total = (key: "images" | "maxMediaCredits") => {
    if (matchedSummarized.unboundedPerTurn) return undefined;
    const given = matchedSummarized.grants.flatMap((grant) =>
      grant[key] !== undefined ? [grant[key]] : [],
    );
    return given.length
      ? given.reduce((sum, value) => sum + value, 0)
      : undefined;
  };
  return {
    images: total("images"),
    maxCredits: total("maxMediaCredits"),
    planTurnIds: turns,
    grants: matchedSummarized.unboundedPerTurn ? [] : allSummarized.grants,
    unboundedPerTurn: matchedSummarized.unboundedPerTurn,
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
  /** Distinct shared durable `grantId` buckets enforced across parallel children and retries. */
  grants?: MediaSpendGrant[];
  /** True when carried owner authority did not impose explicit media count/credit caps. */
  unboundedPerTurn?: boolean;
}

export async function checkImageRequest(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
  toolCallId: string,
  operationKey: string | null = null,
) {
  const input = generateImageInputSchema.parse(raw);
  const allowance = await mayMakeMediaForOwner(runtime, authorized, {
    projectId: input.projectId,
    capability: "generate_image",
  });
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
        replayedReceiptId: null,
        OR: [
          { disposition: null },
          { disposition: { notIn: ["REJECTED", "ALREADY_SATISFIED"] } },
        ],
        NOT: { turnId: authorized.turn.id, toolCallId },
      },
    });
  const perTurn = (await runtime.mediaPerTurn(authorized)).images;
  if ((await startedOn([authorized.turn.id])) >= perTurn)
    throw new SokoBotRuntimeValidationError(
      `One turn may start at most ${perTurn} images. Show your owner these first.`,
    );
  const authoritySpend: MediaSpendRequest | null =
    allowance.grants &&
    allowance.grants.length > 0 &&
    !allowance.unboundedPerTurn
      ? {
          sokoBotId: authorized.turn.sokoBotId,
          workspaceId: authorized.turn.workspaceId,
          turnId: authorized.turn.id,
          toolCallId,
          operationKey,
          capability: "generate_image",
          projectId: input.projectId,
          images: 1,
          videos: 0,
          credits: input.maxCredits,
          grants: allowance.grants,
        }
      : null;
  if (authoritySpend) {
    await checkGrantSpendPreflight(prisma, authoritySpend);
  }
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
        { cause: error },
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
  return {
    input,
    model,
    settings,
    credits,
    referenceFileIds,
    style,
    authoritySpend,
  };
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
  operationKey: string | null = null,
) {
  const input = generateVideoInputSchema.parse(raw);
  const allowance = await mayMakeMediaForOwner(runtime, authorized, {
    projectId: input.projectId,
    capability: "generate_video",
  });
  if (!allowance)
    throw new SokoBotRuntimeAuthorizationError(
      "Videos are generated only when a person asks in chat. Describe the video you would make instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const authoritySpend: MediaSpendRequest | null =
    allowance.grants &&
    allowance.grants.length > 0 &&
    !allowance.unboundedPerTurn
      ? {
          sokoBotId: authorized.turn.sokoBotId,
          workspaceId: authorized.turn.workspaceId,
          turnId: authorized.turn.id,
          toolCallId,
          operationKey,
          capability: "generate_video",
          projectId: input.projectId,
          images: 0,
          videos: 1,
          credits: input.maxCredits,
          grants: allowance.grants,
        }
      : null;
  if (authoritySpend) {
    await checkGrantSpendPreflight(prisma, authoritySpend);
  }
  const started = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: "generate_video",
      replayedReceiptId: null,
      OR: [
        { disposition: null },
        { disposition: { notIn: ["REJECTED", "ALREADY_SATISFIED"] } },
      ],
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
        { cause: error },
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
  return { input, model, settings, credits, sourceAssetId, authoritySpend };
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
  operationKey: string | null = null,
) {
  const input = generateTalkingVideoInputSchema.parse(raw);
  const allowance = await mayMakeMediaForOwner(runtime, authorized, {
    projectId: input.projectId,
    capability: "generate_talking_video",
  });
  if (!allowance)
    throw new SokoBotRuntimeAuthorizationError(
      "Talking videos are made only when a person asks in chat. Write the script you would use instead.",
    );
  runtime.refuseCmoRunMedia(authorized);
  const authoritySpend: MediaSpendRequest | null =
    allowance.grants &&
    allowance.grants.length > 0 &&
    !allowance.unboundedPerTurn
      ? {
          sokoBotId: authorized.turn.sokoBotId,
          workspaceId: authorized.turn.workspaceId,
          turnId: authorized.turn.id,
          toolCallId,
          operationKey,
          capability: "generate_talking_video",
          projectId: input.projectId,
          images: 0,
          videos: 1,
          credits: input.maxCredits,
          grants: allowance.grants,
        }
      : null;
  if (authoritySpend) {
    await checkGrantSpendPreflight(prisma, authoritySpend);
  }
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
        { cause: error },
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
  return { input, model, credits, authoritySpend };
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
