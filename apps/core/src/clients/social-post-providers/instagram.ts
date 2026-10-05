import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteProjectSocialSession } from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  createSocialPublishSession,
  executeSocialPublishTool,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";

const INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG = "INSTAGRAM_POST_IG_USER_MEDIA";
const INSTAGRAM_PUBLISH_TOOL_SLUG = "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH";

const INSTAGRAM_TOOL_SLUGS = [
  INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG,
  INSTAGRAM_PUBLISH_TOOL_SLUG,
];

function idOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.id, data?.creation_id, data?.media_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

/**
 * Instagram's two-step publish: a media container carries the public Drive URL
 * and caption, then the publish tool waits for processing and returns the media
 * id. Meta fetches the media itself, so nothing is downloaded here.
 */
export async function publishInstagramPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("instagram");
  const sessionId = await createSocialPublishSession({
    toolkitSlug: "instagram",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: INSTAGRAM_TOOL_SLUGS,
    context: "create Project Instagram publish session",
    signal: context.signal,
  });
  const igUserId = context.externalAccountId;
  try {
    const video = context.media.find((ref) => ref.kind === "video");
    const container = await executeSocialPublishTool({
      sessionId,
      toolSlug: INSTAGRAM_CREATE_CONTAINER_TOOL_SLUG,
      arguments: {
        ig_user_id: igUserId,
        ...(context.text ? { caption: context.text } : {}),
        ...(video ? { video_url: video.fileUrl } : {}),
        ...(!video && context.media[0]
          ? { image_url: context.media[0].fileUrl }
          : {}),
      },
      context: "create Instagram media container",
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
      executeSocialPublishTool({
        sessionId,
        toolSlug: INSTAGRAM_PUBLISH_TOOL_SLUG,
        arguments: {
          ig_user_id: igUserId,
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
