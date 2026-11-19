import { z } from "zod";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { publishZernioPost } from "@/clients/social-post-providers/zernio-post";
import { zernioRequest } from "@/clients/zernio.client";

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

  return publishZernioPost({
    context,
    accountId,
    platform: "tiktok",
    urlHost: /(^|\.)tiktok\.com$/i,
    toolSlug: ZERNIO_TIKTOK_CREATE_POST,
    providerOutcome: `published (${settings.privacyLevel})`,
    refused: "TikTok refused the video",
    body: {
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
}
