import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { ZernioApiError, zernioRequest } from "@/clients/zernio.client";

export const ZERNIO_TIKTOK_CREATE_POST = "ZERNIO_TIKTOK_CREATE_POST";

const interaction = z.object({ enabled: z.boolean() });
const creatorInfo = z.object({
  creator: z.object({ nickname: z.string().min(1), canPostMore: z.boolean() }),
  privacyLevels: z.array(z.object({ value: z.string() })),
  postingLimits: z.object({
    maxVideoDurationSec: z.number().int().positive(),
    interactionSettings: z.object({
      allow_comment: interaction,
      allow_duet: interaction,
      allow_stitch: interaction,
    }),
  }),
});

export async function getZernioTikTokCreatorInfo(
  accountId: string,
  signal?: AbortSignal,
) {
  const info = creatorInfo.parse(
    await zernioRequest(
      `/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=video`,
      { signal },
    ),
  );
  const { interactionSettings, maxVideoDurationSec } = info.postingLimits;
  return {
    creator_nickname: info.creator.nickname,
    // New Zernio connections use TikTok for Business, which only direct-posts public videos.
    privacy_level_options: info.creator.canPostMore
      ? info.privacyLevels
          .map(({ value }) => value)
          .filter((value) => value === "PUBLIC_TO_EVERYONE")
      : [],
    comment_disabled: !interactionSettings.allow_comment.enabled,
    duet_disabled: !interactionSettings.allow_duet.enabled,
    stitch_disabled: !interactionSettings.allow_stitch.enabled,
    max_video_post_duration_sec: maxVideoDurationSec,
  };
}

const postResponse = z.object({
  post: z.object({
    _id: z.string().min(1),
    platforms: z.tuple([
      z.object({
        platform: z.literal("tiktok"),
        accountId: z
          .union([
            z.string(),
            z.object({ _id: z.string() }).transform((account) => account._id),
          ])
          .optional(),
        status: z.string(),

        platformPostUrl: z
          .url({ protocol: /^https$/, hostname: /(^|\.)tiktok\.com$/i })
          .nullish()
          .catch(null),
      }),
    ]),
  }),
});

export async function publishZernioTikTokVideo(
  context: SocialPostPublishContext,
  accountId: string,
  video: SocialPostPublishContext["media"][number],
): Promise<SocialPostPublishResult> {
  const settings = context.tikTokSettings;
  const creator = await getZernioTikTokCreatorInfo(accountId, context.signal);
  if (
    !settings?.acceptedMusicUsage ||
    !creator.privacy_level_options.some(
      (level) => level === settings.privacyLevel,
    )
  ) {
    throw new ComposioToolError({
      message: "Choose an available TikTok audience before publishing",
    });
  }
  if (!settings.previewConsent)
    throw new ComposioToolError({
      message:
        "Confirm the TikTok video preview and give permission to publish",
    });
  if (!context.postId)
    throw new Error("TikTok publishing requires a Social post ID");

  let response: unknown;
  try {
    response = await zernioRequest("/posts", {
      method: "POST",
      idempotencyKey: context.postId,
      signal: context.signal,
      body: {
        publishNow: true,
        content: context.text,
        mediaItems: [{ type: "video", url: video.fileUrl }],
        platforms: [{ platform: "tiktok", accountId }],
        tiktokSettings: {
          ...((context.aiGenerated || video.aiGenerated) && {
            videoMadeWithAi: true,
          }),
          privacy_level: settings.privacyLevel,
          allow_comment: settings.allowComment && !creator.comment_disabled,
          allow_duet: settings.allowDuet && !creator.duet_disabled,
          allow_stitch: settings.allowStitch && !creator.stitch_disabled,
          commercial_content_type: settings.promotesOwnBrand
            ? "brand_organic"
            : "none",
          content_preview_confirmed: settings.previewConsent,
          express_consent_given: settings.previewConsent,
        },
      },
    });
  } catch (error) {
    // A timeout or idempotency conflict can mean the original post is still publishing.
    if (
      error instanceof ZernioApiError &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 409
    ) {
      throw new ComposioToolError({
        message: `Zernio refused the TikTok video (HTTP ${error.status})`,
      });
    }
    throw new ComposioPublishOutcomeUnknownError("TikTok");
  }

  for (;;) {
    const result = postResponse.safeParse(response);
    if (!result.success) throw new ComposioPublishOutcomeUnknownError("TikTok");
    const {
      _id,
      platforms: [entry],
    } = result.data.post;
    if (entry.accountId && entry.accountId !== accountId)
      throw new ComposioPublishOutcomeUnknownError("TikTok");
    if (entry.status === "published") {
      return {
        externalId: _id,
        publishedUrl: entry.platformPostUrl ?? null,
        providerOutcome: `published (${settings.privacyLevel})`,
        toolSlug: ZERNIO_TIKTOK_CREATE_POST,
      };
    }
    if (entry.status === "failed" || entry.status === "cancelled") {
      throw new ComposioToolError({ message: "TikTok refused the video" });
    }
    if (!["pending", "uploading", "processing"].includes(entry.status)) {
      throw new ComposioPublishOutcomeUnknownError("TikTok");
    }
    try {
      await delay(5_000, undefined, { signal: context.signal });
      response = await zernioRequest(`/posts/${encodeURIComponent(_id)}`, {
        signal: context.signal,
      });
    } catch {
      throw new ComposioPublishOutcomeUnknownError("TikTok");
    }
  }
}
