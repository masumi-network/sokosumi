import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteProjectSocialSession } from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioPublishOutcomeUnknownError,
  createSocialPostToolSession,
  executeSocialPostTool,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";

const FACEBOOK_CREATE_POST_TOOL_SLUG = "FACEBOOK_CREATE_POST";
const FACEBOOK_CREATE_PHOTO_TOOL_SLUG = "FACEBOOK_CREATE_PHOTO_POST";
const FACEBOOK_CREATE_MULTI_PHOTO_TOOL_SLUG =
  "FACEBOOK_CREATE_MULTI_PHOTO_POST";
const FACEBOOK_CREATE_VIDEO_TOOL_SLUG = "FACEBOOK_CREATE_VIDEO_POST";

const FACEBOOK_TOOL_SLUGS = [
  FACEBOOK_CREATE_POST_TOOL_SLUG,
  FACEBOOK_CREATE_PHOTO_TOOL_SLUG,
  FACEBOOK_CREATE_MULTI_PHOTO_TOOL_SLUG,
  FACEBOOK_CREATE_VIDEO_TOOL_SLUG,
];

function externalIdOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.post_id, data?.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function permalinkOf(data: Record<string, unknown> | null): string | null {
  return typeof data?.permalink_url === "string" && data.permalink_url
    ? data.permalink_url
    : null;
}

/**
 * Publishes to the connection's single managed Page. Photos and videos are
 * handed to Facebook by their public Drive URLs, so nothing is downloaded.
 */
export async function publishFacebookPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("facebook");
  const sessionId = await createSocialPostToolSession({
    toolkitSlug: "facebook",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: FACEBOOK_TOOL_SLUGS,
    context: "create Project Facebook publish session",
    signal: context.signal,
  });
  const pageId = context.externalAccountId;
  const images = context.media.filter((ref) => ref.kind === "image");
  const video = context.media.find((ref) => ref.kind === "video");
  const toolSlug = video
    ? FACEBOOK_CREATE_VIDEO_TOOL_SLUG
    : images.length > 1
      ? FACEBOOK_CREATE_MULTI_PHOTO_TOOL_SLUG
      : images.length === 1
        ? FACEBOOK_CREATE_PHOTO_TOOL_SLUG
        : FACEBOOK_CREATE_POST_TOOL_SLUG;
  const toolArguments = video
    ? {
        page_id: pageId,
        file_url: video.fileUrl,
        description: context.text,
        published: true,
      }
    : images.length > 1
      ? {
          page_id: pageId,
          photo_urls: images.map((ref) => ref.fileUrl),
          message: context.text,
        }
      : images.length === 1
        ? {
            page_id: pageId,
            url: images[0].fileUrl,
            message: context.text,
            published: true,
          }
        : { page_id: pageId, message: context.text, published: true };

  try {
    const post = await guardSocialCreateOutcome(label, () =>
      executeSocialPostTool({
        sessionId,
        toolSlug,
        arguments: toolArguments,
        context: "publish Facebook post",
        refused: "Facebook refused the post",
        signal: context.signal,
      }),
    );
    const externalId = externalIdOf(post);
    if (!externalId) throw new ComposioPublishOutcomeUnknownError(label);
    return {
      externalId,
      publishedUrl:
        permalinkOf(post) ??
        socialPostPublishedUrl("facebook", context.externalHandle, externalId),
      toolSlug,
    };
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      "delete Project Facebook publish session",
    );
  }
}
