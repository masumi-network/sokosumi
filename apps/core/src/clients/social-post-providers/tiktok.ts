import { setTimeout as delay } from "node:timers/promises";
import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteProjectSocialSession } from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import { tiktokPublishedVideoId } from "@/clients/social-post-providers/tiktok-video-id";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  createSocialPostToolSession,
  executeSocialPostTool,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";

const TIKTOK_QUERY_CREATOR_TOOL_SLUG = "TIKTOK_QUERY_CREATOR_INFO";
const TIKTOK_PUBLISH_TOOL_SLUG = "TIKTOK_PUBLISH_VIDEO";
const TIKTOK_STATUS_TOOL_SLUG = "TIKTOK_FETCH_PUBLISH_STATUS";

const TIKTOK_TOOL_SLUGS = [
  TIKTOK_QUERY_CREATOR_TOOL_SLUG,
  TIKTOK_PUBLISH_TOOL_SLUG,
  TIKTOK_STATUS_TOOL_SLUG,
];

/** Most permissive first; unaudited apps only offer `SELF_ONLY`. */
const TIKTOK_PRIVACY_ORDER = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

const POLL_START_MS = 5_000;
const POLL_CAP_MS = 30_000;

/** Picks the most permissive privacy level the account currently offers. */
export function pickTikTokPrivacyLevel(
  available: readonly string[],
): (typeof TIKTOK_PRIVACY_ORDER)[number] {
  return (
    TIKTOK_PRIVACY_ORDER.find((level) => available.includes(level)) ??
    "SELF_ONLY"
  );
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function statusOf(data: Record<string, unknown> | null): string | null {
  return stringOf(data?.status)?.toUpperCase() ?? null;
}

/**
 * Publishes a video to TikTok: reads the creator's live privacy options, posts
 * with the most permissive one, then polls until the provider finishes. Once
 * the publish call is initiated, a timeout is an unknown outcome — TikTok may
 * still complete it, so a blind retry could publish twice.
 */
export async function publishTikTokVideo(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("tiktok");
  const sessionId = await createSocialPostToolSession({
    toolkitSlug: "tiktok",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: TIKTOK_TOOL_SLUGS,
    context: "create Project TikTok publish session",
    signal: context.signal,
  });
  const video = context.media.find((ref) => ref.kind === "video");
  try {
    const creator = await executeSocialPostTool({
      sessionId,
      toolSlug: TIKTOK_QUERY_CREATOR_TOOL_SLUG,
      arguments: {},
      context: "read TikTok creator info",
      refused: "TikTok refused the creator info",
      signal: context.signal,
    });
    const options = Array.isArray(creator?.privacy_level_options)
      ? creator.privacy_level_options.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const privacyLevel = pickTikTokPrivacyLevel(options);

    const published = await guardSocialCreateOutcome(label, () =>
      executeSocialPostTool({
        sessionId,
        toolSlug: TIKTOK_PUBLISH_TOOL_SLUG,
        arguments: {
          video_url: video?.fileUrl,
          caption: context.text,
          privacy_level: privacyLevel,
        },
        context: "publish TikTok video",
        refused: "TikTok refused the video",
        timeoutMs: 60_000,
        signal: context.signal,
      }),
    );
    const publishId =
      stringOf(published?.publish_id) ?? stringOf(published?.id);
    if (!publishId) throw new ComposioPublishOutcomeUnknownError(label);

    let waitMs = POLL_START_MS;
    let refusal: ComposioToolError | null = null;
    try {
      for (;;) {
        context.signal?.throwIfAborted();
        const status = await executeSocialPostTool({
          sessionId,
          toolSlug: TIKTOK_STATUS_TOOL_SLUG,
          arguments: { publish_id: publishId },
          context: "check TikTok publish status",
          refused: "TikTok refused the status check",
          signal: context.signal,
        });
        const state = statusOf(status);
        if (state === "PUBLISH_COMPLETE") {
          const videoId = tiktokPublishedVideoId(status) ?? publishId;
          return {
            externalId: videoId,
            publishedUrl: socialPostPublishedUrl(
              "tiktok",
              context.externalHandle,
              videoId,
            ),
            providerOutcome: `published (${privacyLevel})`,
            toolSlug: TIKTOK_PUBLISH_TOOL_SLUG,
          };
        }
        if (state === "FAILED") {
          refusal = new ComposioToolError({
            message: "TikTok refused the video",
            providerMessage: stringOf(status?.fail_reason),
          });
          throw refusal;
        }
        await delay(waitMs, undefined, { signal: context.signal });
        waitMs = Math.min(waitMs * 2, POLL_CAP_MS);
      }
    } catch (error) {
      // Only TikTok's own FAILED verdict is a refusal. Any other error here,
      // including a transient status-check failure, comes after the video was
      // handed over, so a retry could publish it twice.
      if (error === refusal) throw error;
      throw new ComposioPublishOutcomeUnknownError(label);
    }
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      "delete Project TikTok publish session",
    );
  }
}
