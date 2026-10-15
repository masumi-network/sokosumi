import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteProjectSocialSession } from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
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

const INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG = "INSTAGRAM_POST_IG_USER_MEDIA";
const INSTAGRAM_CREATE_CAROUSEL_TOOL_SLUG =
  "INSTAGRAM_CREATE_CAROUSEL_CONTAINER";
const INSTAGRAM_PUBLISH_TOOL_SLUG = "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH";

const INSTAGRAM_TOOL_SLUGS = [
  INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG,
  INSTAGRAM_CREATE_CAROUSEL_TOOL_SLUG,
  INSTAGRAM_PUBLISH_TOOL_SLUG,
];

function idOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.id, data?.creation_id, data?.media_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function singleContainerArguments(
  context: SocialPostPublishContext,
): Record<string, unknown> {
  const video = context.media.find((ref) => ref.kind === "video");
  return {
    ig_user_id: context.externalAccountId,
    ...(context.text ? { caption: context.text } : {}),
    ...(video ? { video_url: video.fileUrl } : {}),
    ...(!video && context.media[0]
      ? { image_url: context.media[0].fileUrl }
      : {}),
  };
}

function carouselContainerArguments(
  context: SocialPostPublishContext,
): Record<string, unknown> {
  const images = context.media.filter((ref) => ref.kind === "image");
  const videos = context.media.filter((ref) => ref.kind === "video");
  return {
    ig_user_id: context.externalAccountId,
    ...(context.text ? { caption: context.text } : {}),
    ...(images.length > 0
      ? { child_image_urls: images.map((ref) => ref.fileUrl) }
      : {}),
    ...(videos.length > 0
      ? { child_video_urls: videos.map((ref) => ref.fileUrl) }
      : {}),
  };
}

/**
 * Instagram's two-step publish: a media container carries the public Drive URL
 * and caption, then the publish tool waits for processing and returns the media
 * id. Two or more items use Composio's carousel container. Meta fetches the
 * media itself, so nothing is downloaded here.
 */
export async function publishInstagramPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("instagram");
  const sessionId = await createSocialPostToolSession({
    toolkitSlug: "instagram",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: INSTAGRAM_TOOL_SLUGS,
    context: "create Project Instagram publish session",
    signal: context.signal,
  });
  const carousel = context.media.length > 1;
  try {
    const container = await executeSocialPostTool({
      sessionId,
      toolSlug: carousel
        ? INSTAGRAM_CREATE_CAROUSEL_TOOL_SLUG
        : INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG,
      arguments: carousel
        ? carouselContainerArguments(context)
        : singleContainerArguments(context),
      context: carousel
        ? "create Instagram carousel container"
        : "create Instagram media container",
      refused: "Instagram refused the media",
      timeoutMs: 60_000,
      signal: context.signal,
    });
    const containerId = idOf(container);
    if (!containerId) {
      throw new ComposioToolError({
        message: "Instagram container creation returned no id",
      });
    }
    const published = await guardSocialCreateOutcome(label, () =>
      executeSocialPostTool({
        sessionId,
        toolSlug: INSTAGRAM_PUBLISH_TOOL_SLUG,
        arguments: {
          ig_user_id: context.externalAccountId,
          creation_id: containerId,
          max_wait_seconds: 180,
        },
        context: "publish Instagram media",
        refused: "Instagram refused the post",
        timeoutMs: 200_000,
        signal: context.signal,
      }),
    );
    const externalId = idOf(published);
    if (!externalId) throw new ComposioPublishOutcomeUnknownError(label);
    return {
      externalId,
      publishedUrl: socialPostPublishedUrl(
        "instagram",
        context.externalHandle,
        externalId,
      ),
      toolSlug: INSTAGRAM_PUBLISH_TOOL_SLUG,
    };
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      "delete Project Instagram publish session",
    );
  }
}
